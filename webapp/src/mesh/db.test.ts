import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { openDb, openHistoryDb } from "./db";

class FakeDatabase {
	onclose: (() => void) | null = null;
	onversionchange: (() => void) | null = null;
	closeCalls = 0;
	readonly created: string[] = [];
	readonly stores: Set<string>;

	constructor(
		stores = [
			"messages",
			"telemetry",
			"nodes",
			"traceroutes",
			"hops",
			"sightings",
			"neighbors",
			"waypoints",
			"annotations",
		],
	) {
		this.stores = new Set(stores);
	}
	objectStoreNames = { contains: (name: string) => this.stores.has(name) };
	createObjectStore(name: string) {
		assert.equal(
			this.stores.has(name),
			false,
			"existing stores must never be recreated",
		);
		this.stores.add(name);
		this.created.push(name);
		return { createIndex() {} };
	}
	close() {
		this.closeCalls++;
	}
	forceClose() {
		this.onclose?.();
	}
}

class FakeOpenRequest {
	result!: IDBDatabase;
	error: DOMException | null = null;
	onupgradeneeded: (() => void) | null = null;
	onsuccess: (() => void) | null = null;
	onerror: (() => void) | null = null;
	succeed(db: FakeDatabase) {
		this.result = db as unknown as IDBDatabase;
		this.onsuccess?.();
	}
	fail(error: DOMException) {
		this.error = error;
		this.onerror?.();
	}
}

function fakeIndexedDb(t: TestContext) {
	const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
	const requests: FakeOpenRequest[] = [];
	const databases: FakeDatabase[] = [];
	const names: [string, number | undefined][] = [];
	let thrown: DOMException | undefined;
	const factory = {
		open(name: string, version?: number) {
			names.push([name, version]);
			if (thrown) {
				const error = thrown;
				thrown = undefined;
				throw error;
			}
			const request = new FakeOpenRequest();
			requests.push(request);
			return request;
		},
		deleteDatabase() {
			assert.fail("connection recovery must never delete saved data");
		},
	};
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: factory,
	});
	t.after(() => {
		for (const db of databases) db.forceClose();
		if (original) Object.defineProperty(globalThis, "indexedDB", original);
		else Reflect.deleteProperty(globalThis, "indexedDB");
	});
	return {
		requests,
		names,
		throwNext(error: DOMException) {
			thrown = error;
		},
		database(stores?: string[]) {
			const db = new FakeDatabase(stores);
			databases.push(db);
			return db;
		},
	};
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("concurrent opens and later callers reuse one healthy connection", async (t) => {
	const fake = fakeIndexedDb(t);
	const first = openDb();
	assert.equal(openDb(), first);
	assert.deepEqual(fake.names, [["lilyshark", 2]]);
	const database = fake.database();
	fake.requests[0].succeed(database);
	assert.equal(await first, database);
	assert.equal(openDb(), first);
	assert.equal(fake.requests.length, 1);
});

test("an aborted open is reported but does not poison future opens", async (t) => {
	const fake = fakeIndexedDb(t);
	const first = openDb();
	const failure = new DOMException("storage process interrupted", "AbortError");
	const rejection = assert.rejects(first, (error) => error === failure);
	fake.requests[0].fail(failure);
	await rejection;
	const second = openDb();
	assert.notEqual(first, second);
	const database = fake.database();
	fake.requests[1].succeed(database);
	assert.equal(await second, database);
});

test("a synchronous factory exception can recover on a later open", async (t) => {
	const fake = fakeIndexedDb(t);
	const failure = new DOMException(
		"storage temporarily unavailable",
		"SecurityError",
	);
	fake.throwNext(failure);
	await assert.rejects(openDb(), (error) => error === failure);
	const retry = openDb();
	const database = fake.database();
	fake.requests[0].succeed(database);
	assert.equal(await retry, database);
	assert.equal(fake.names.length, 2);
});

test("abnormal close invalidates the connection without evicting its replacement later", async (t) => {
	const fake = fakeIndexedDb(t);
	const first = openDb();
	const oldDatabase = fake.database();
	fake.requests[0].succeed(oldDatabase);
	await first;
	oldDatabase.forceClose();
	const second = openDb();
	assert.notEqual(second, first);
	const replacement = fake.database();
	fake.requests[1].succeed(replacement);
	await second;
	oldDatabase.forceClose();
	assert.equal(openDb(), second);
	assert.equal(fake.requests.length, 2);
});

test("version changes release the old connection so another tab can upgrade", async (t) => {
	const fake = fakeIndexedDb(t);
	const first = openDb();
	const oldDatabase = fake.database();
	fake.requests[0].succeed(oldDatabase);
	await first;
	oldDatabase.onversionchange?.();
	assert.equal(oldDatabase.closeCalls, 1);
	const second = openDb();
	const replacement = fake.database();
	fake.requests[1].succeed(replacement);
	assert.equal(await second, replacement);
	assert.notEqual(second, first);
});

test("history startup retries one aborted connection open", async (t) => {
	const fake = fakeIndexedDb(t);
	const startup = openHistoryDb();
	fake.requests[0].fail(new DOMException("interrupted", "AbortError"));
	await nextTurn();
	assert.equal(fake.requests.length, 2);
	const database = fake.database();
	fake.requests[1].succeed(database);
	assert.equal(await startup, database);
});

test("persistent startup failures remain visible after one retry", async (t) => {
	const fake = fakeIndexedDb(t);
	const startup = openHistoryDb();
	const failure = new DOMException("still interrupted", "AbortError");
	const rejection = assert.rejects(startup, (error) => error === failure);
	fake.requests[0].fail(new DOMException("interrupted", "AbortError"));
	await nextTurn();
	fake.requests[1].fail(failure);
	await rejection;
	assert.equal(fake.requests.length, 2);
});

test("history startup does not retry permission or schema errors", async (t) => {
	const fake = fakeIndexedDb(t);
	const startup = openHistoryDb();
	const failure = new DOMException("newer database version", "VersionError");
	const rejection = assert.rejects(startup, (error) => error === failure);
	fake.requests[0].fail(failure);
	await rejection;
	assert.equal(fake.requests.length, 1);
});

test("the existing schema upgrade preserves stores and only adds annotations", async (t) => {
	const fake = fakeIndexedDb(t);
	const opening = openDb();
	const existing = [
		"messages",
		"telemetry",
		"nodes",
		"traceroutes",
		"hops",
		"sightings",
		"neighbors",
		"waypoints",
	];
	const database = fake.database(existing);
	fake.requests[0].result = database as unknown as IDBDatabase;
	fake.requests[0].onupgradeneeded?.();
	fake.requests[0].succeed(database);
	await opening;
	assert.deepEqual(database.created, ["annotations"]);
	for (const name of existing) assert.ok(database.stores.has(name));
});
