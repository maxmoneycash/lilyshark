import assert from "node:assert/strict";
import test from "node:test";
import { NAV_TABS, parentTab, tabFromLocation, tabHref } from "./navigation";

test("every navigation destination survives a reload", () => {
  for (const tab of [...NAV_TABS, "PAPER", "DEBUG"] as const) {
    const url = new URL(tabHref(tab), "https://lilyshark.com");
    assert.equal(tabFromLocation(url), tab);
  }
});

test("direct installer links and its checksum anchor stay on Flash", () => {
  for (const path of ["/flash", "/flash/", "/flash/index.html"]) {
    for (const hash of ["", "#verify"]) {
      assert.equal(tabFromLocation({ pathname: path, hash }), "FLASH");
    }
  }
  assert.equal(tabFromLocation({ pathname: "/", hash: "" }), "INTRO");
  assert.equal(tabFromLocation({ pathname: "/flashback", hash: "" }), "INTRO");
});

test("capture permalinks and legacy documentation links remain valid", () => {
  assert.equal(
    tabFromLocation({ pathname: "/", hash: "#sniffer?frame=417" }),
    "SNIFFER",
  );
  assert.equal(
    tabFromLocation({ pathname: "/", hash: "#resolve?blob=capture" }),
    "TRAFFIC",
  );
  assert.equal(
    tabFromLocation({ pathname: "/flash/", hash: "#paper" }),
    "PAPER",
  );
  assert.equal(parentTab("PAPER"), "DOCS");
  assert.equal(parentTab("DEBUG"), "CONFIG");
  assert.equal(NAV_TABS.includes("FLASH"), true);
  assert.equal(NAV_TABS.length, 13);
});
