# First run and connecting a deck — September 29, 2026

Max's brief: people should want to download the app. The demo and the use case
have to sell it, and connecting a T-Deck has to feel great.

Before this pass:
- **First launch:** four pages of text about PINs and radio profiles.
- **Disconnected home:** a long technical essay.
- **Connecting:** a settings-style list mixing Bluetooth, Wi-Fi and USB, which
  closed the moment a link came up, so there was no moment of arrival.

## Research

A research pass read the actual source of the Meshtastic Apple app, PommeCore,
MeshCore One and meshcore-open, plus Apple's AccessorySetupKit documentation.
What it found:
- **Meshtastic:** permission pages first. The Connect tab is a list sorted by
  name with signal bars. It shows real node-download progress, but nothing
  marks arrival.
- **PommeCore:** six onboarding pages, then a scanner sheet that closes on connect.
- **MeshCore One:** an AccessorySetupKit picker, "I don't have a device yet",
  and a hidden demo for App Review.
- **None of them** has a scanning animation, a "found your deck" moment, a
  first-connection payoff, or haptics.

## What ships now (iPhone)

1. **Welcome** (`OnboardingView`): one screen.
   - The 3D T-Deck, "Talk to the mesh around you", and one sentence: message
     people kilometres away with no cell service, internet or account.
   - Three situations: off the grid, in a crowd, when the network is down.
   - Two actions: **Connect my T-Deck** and **Explore the demo**, plus a link
     to put Lilyshark on a T-Deck.
   - No permission prompts appear on this screen.
2. **Connect** (`ConnectFlowView`): a full-screen guided flow instead of a list.
   - **Search:** a radar with the phone in the middle. Radios appear as glass
     orbs, placed by signal strength (nearer the centre is stronger), and as big
     cards sorted by signal, each with a Connect button. The screen says
     plainly that placement is by signal, not distance.
   - **Bluetooth problems** are explained inline: turned off, or permission
     denied, with an Open Settings button.
   - **Help** appears by itself after 12 seconds. It starts with the most common
     real cause: a radio connected to the Meshtastic or MeshCore app on the same
     phone stops advertising.
   - **Connecting:** four steps tick off from the real connection state: reaching
     the deck, opening its radio service, reading its settings (the deck's name
     appears), and listening to the mesh, counting nodes as they arrive.
   - **Timeouts:** 45 seconds for a deck, which has no Bluetooth PIN (the
     firmware enables no BLE security). 90 seconds for a MeshCore radio, which
     may raise the system PIN prompt partway through.
   - **Arrival:** "You're on the mesh", a success haptic, two rings leaving the
     deck and a check on it, nodes heard and battery once there are any, and
     the first few nodes' orbs with their names. Until the deck has heard
     anyone it says "Listening for other radios" with a pulse, not "0 nodes". The two buttons
     are **Say hello on the public channel** (opens it with "Hello from <deck>"
     drafted) and **See who's around** (the map).
   - **Failure:** what happened, what usually fixes it (including a PIN tip for
     MeshCore radios), and Search again.
   - **Other links:** Wi-Fi and USB keep the old list under "Other ways to
     connect". A demo link is on every screen.
3. **Demo** (`MeshDemoView`): "A day on the trail".
   - Nobody has signal. You send Alex a message, watch it hop through a ridge
     repeater on a small terrain map, get "Delivered · via Ridge repeater", and
     read Alex's reply.
   - Suggested replies mean you don't have to type anything.
   - It ends with "That's the mesh", Connect my T-Deck, and Put Lilyshark on a
     T-Deck.
   - A "Demo · simulated, no radio" label stays on screen the whole time. The
     demo touches no store and no radio, and forgets everything when it closes.
4. **Permissions** now come when they mean something.
   - **Bluetooth:** switched on when someone chooses to connect.
   - **Notifications:** first asked once a deck is connected, not at first
     launch, and held until the connect flow closes, so the prompt never
     lands on "You're on the mesh". Returning users still have their
     notification categories registered on every launch.
5. **The disconnected home** gains a Demo button next to Connect my T-Deck.

## Simulator check, evening of September 29

The machine was finally quiet enough to run the flows in the iPhone 17 Pro
simulator (iOS 26.5) and look at them. What the screenshots showed, and what
changed:

- **The notification prompt covered the arrival screen.** It fired on the
  connection becoming ready, which is the moment "You're on the mesh"
  appears. ContentView now holds it until the connect flow has closed.
- **The welcome's buttons sat on top of its text.** The 3D deck has a
  420-point floor in `TDeckStage`, so the sentence under the title ran under
  Connect and Explore, and the use-case cards showed through the translucent
  Explore button. The welcome now sizes the deck to 60% of the visible
  height (260 to 400 points) and puts the buttons on a solid backdrop with a
  short fade above it.
- **The demo's label sat on the conversation.** The top bar was an overlay
  with no backdrop. It is now a top inset with a solid backdrop and a fade,
  and suggestions disappear once sent.
- **The radar put a strong radio on top of the phone** and cut its name off.
  Radios now sit 60 to 85% of the way out, with room for the name.
- **The arrival screen opened on "0 nodes heard"** with the simulator's
  preview deck, and on a lone "1 channel" card. See Arrival above.
- **Names wrapped at their hyphen** ("Lilyshark T-" over "Deck Plus"). Names
  in titles and cards use a non-breaking hyphen.

Screenshots: [welcome](qa/connect-onboarding-2026-09-29/welcome.png),
[found](qa/connect-onboarding-2026-09-29/found.png),
[arrival](qa/connect-onboarding-2026-09-29/arrival.png),
[demo in flight](qa/connect-onboarding-2026-09-29/demo-sending.png),
[demo end](qa/connect-onboarding-2026-09-29/demo-end.png).

Not checked here: anything that needs a tap (these runs use launch
arguments), the failure screen, a real deck, and a real iPhone.

Two simulator traps, for the next person: `simctl launch
--terminate-running-process` hangs on this machine, so the capture script
stops the app by its host process ID; and an unanswered permission prompt
survives an uninstall, because SpringBoard owns it.

## Next

- **AccessorySetupKit** is the step after this. It needs no Bluetooth
  permission, uses a one-tap system picker with our product image, handles PIN
  entry itself, and gets better background relaunch.
  - It cannot coexist with the app's current global scan, so it replaces that
    path on iOS 18+ rather than sitting beside it.
  - The deck must advertise the Meshtastic service UUID in its primary packet.
    Today the firmware puts the LSK service there and the name in the scan
    response.
  - Info.plist keys: `NSAccessorySetupKitSupports` = `[Bluetooth]` and
    `NSAccessorySetupBluetoothServices`.
- **The deck's own screen** already confirms the link: it chimes and shows
  PHONE CONNECTED OVER BLUETOOTH. The connect flow now points at that
  ("Your deck chimes and shows Phone connected") so the two screens agree.
- **App Store Connect** has no Lilyshark app record yet. Apple does not allow
  creating one through the API. Once it exists (bundle `com.lilyshark.app`),
  TestFlight builds can be uploaded with the API key already on this machine.
- **Physical verification:** a real deck and a real iPhone. The simulator only
  has the preview deck.
