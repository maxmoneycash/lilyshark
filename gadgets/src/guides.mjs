export const guides = [
  {
    slug:'mesh', title:'Meshtastic: keyboard or companion app?', eyebrow:'OFF-GRID MESSAGING',
    summary:'A keyboard, a phone-connected tracker, or an e-paper node? Start with how you want to send a message.',
    intro:'A LoRa radio is only one part of a messaging setup. The firmware, regional band and other people’s devices must work together. These three choices are documented for Meshtastic; other LoRa products may use different software.',
    picks:[
      {slug:'lilygo-t-deck-plus', reason:'You want a physical keyboard', detail:'Screen, keyboard and trackball in one handheld. Confirm the firmware and exact hardware variant.'},
      {slug:'sensecap-t1000-e', reason:'You already carry a phone', detail:'A card-sized tracker with no screen. Use the phone for messaging and keep the magnetic charging cable nearby.'},
      {slug:'thinknode-m1', reason:'You want an e-paper status display', detail:'A phone-connected node with an e-paper display and GNSS. Choose the correct regional radio variant.'}
    ],
    checks:['Match the radio band to your region and the devices you plan to use.','Check the exact firmware target, charging cable and included antenna.','A screen does not necessarily let you compose messages; check the input method.'],
    steps:[
      {title:'Start with two nearby nodes',text:'Use two compatible Meshtastic nodes for a repeatable first test. Charge them and identify each device’s exact model.',url:'https://meshtastic.org/docs/getting-started/',label:'Meshtastic setup guide'},
      {title:'Match the configuration',text:'Follow the official setup for your hardware. Set the appropriate region and use matching channel settings on both nodes.',url:'https://meshtastic.org/docs/getting-started/initial-config/',label:'Initial configuration'},
      {title:'Send a message and get a reply',text:'Confirm a message in both directions before trying greater distance. Record the hardware, firmware and settings so you can repeat the test.',url:'https://meshtastic.org/docs/software/',label:'Meshtastic clients'}
    ],
    sourceNote:'Selections are based on the source-checked catalog and Meshtastic documentation. They are starting points, not a field-tested ranking.'
  },
  {
    slug:'wifi', title:'Choose your wireless survey setup', eyebrow:'WI-FI & BLUETOOTH',
    summary:'Start with the screen you want to use: a handheld, your phone, or a Flipper you already own.',
    intro:'A chip that supports Wi-Fi does not tell you what the finished tool can do. Check the installed firmware, supported bands, logging format and how you will control the device.',
    picks:[
      {slug:'bleshark-nano',reason:'You want a small handheld',detail:'An ESP32-C3 tool with its own OLED. Its Wi-Fi radio is 2.4 GHz; do not expect 5 GHz support.'},
      {slug:'biscuit-ultra',reason:'You want to use your phone',detail:'A screen-free survey device using your phone for its interface and GPS. The maker listing was sold out at review.'},
      {slug:'scout-lite',reason:'You already own a Flipper Zero',detail:'A C5 Wi-Fi module with GPS. The Flipper is a separate host, and compatible firmware is required.'}
    ],
    checks:['Confirm 2.4 GHz versus dual-band support in the exact hardware and firmware.','Include the phone, host device, enclosure and storage in your setup.','Check how you retrieve logs before you choose a device.'],
    steps:[
      {title:'Choose a small test you can repeat',text:'Use a network and devices you own. Decide whether you want to see nearby identifiers, examine signal strength or record a GPS-tagged survey.',device:'bleshark-nano'},
      {title:'Check the firmware and storage',text:'Use the instructions for the exact model. Record its firmware version and confirm that its survey mode produces the output you need.',device:'scout-lite'},
      {title:'Run and inspect a short survey',text:'Keep the first route short. Open the saved output and confirm that its timestamps and location data make sense before relying on a longer capture.',device:'biscuit-ultra'}
    ],
    sourceNote:'This guide compares documented form factors and requirements. Radio coverage, app compatibility and battery runtime have not been measured here.'
  },
  {
    slug:'rfid', title:'RFID: handheld, emulator or host tool?', eyebrow:'RFID & NFC',
    summary:'A general-purpose handheld, a small emulator, or a computer-connected research tool.',
    intro:'RFID is a family of technologies. Frequency, tag type and supported operations matter more than a long list of acronyms. Start with tags you own and identify the exact technology before choosing hardware.',
    picks:[
      {slug:'flipper-zero',reason:'You want to explore several technologies',detail:'An onboard screen and controls, with RFID, NFC and infrared. Wi-Fi is a separate hardware addition.'},
      {slug:'chameleon-ultra',reason:'You want a compact emulator',detail:'Dedicated RFID hardware configured through compatible client software. Supported tags and operations vary with firmware.'},
      {slug:'proxmark3-rdv4',reason:'You want a computer-based research workflow',detail:'A focused LF/HF RFID platform. Count wireless and standalone-power modules as separate accessories.'}
    ],
    checks:['Identify the frequency and type of your own test tags.','Check the firmware’s supported read, write and emulation operations separately.','Include client software, cables and optional modules in your setup.'],
    steps:[
      {title:'Identify your test tag',text:'Start with a tag you own and can replace. Check the device documentation for that tag technology before changing anything.',device:'flipper-zero'},
      {title:'Read before writing',text:'Use the maker’s documented read workflow and record the detected tag type. Do not assume that reading a tag implies that it can be emulated.',device:'chameleon-ultra'},
      {title:'Keep a useful lab note',text:'Save the tag type, tool, firmware and observed result. That record makes future compatibility checks much easier.',device:'proxmark3-rdv4'}
    ],
    sourceNote:'These are documented capabilities, not claims of universal card compatibility. No access-system bypass is implied.'
  },
  {
    slug:'computers', title:'Which kind of pocket computer?', eyebrow:'POCKET COMPUTING',
    summary:'Choose the software and input method before falling for a tiny enclosure.',
    intro:'A writing device, a Linux keyboard computer and a modular handheld solve different problems. These projects are in preorder or development stages; read the latest maker update before committing to one.',
    picks:[
      {slug:'pocketmage',reason:'You want an e-paper writing device',detail:'A keyboard-focused ESP32-S3 project running FreeRTOS-based firmware. It is not a desktop Linux machine.'},
      {slug:'cardputer-zero',reason:'You want a small Linux keyboard computer',detail:'A Raspberry Pi CM0-based design with a 46-key keyboard. Software and documentation are work in progress.'},
      {slug:'mecha-comet',reason:'You want modular Linux hardware',detail:'Compare the i.MX 8M Plus and i.MX 95 configurations carefully. Display and wireless details depend on the selected version.'}
    ],
    checks:['Name one application or workflow you want to run, and confirm that it is supported.','Check keyboard size, screen resolution and how you transfer files.','Read the exact configuration and delivery status; campaign prototypes can change.'],
    steps:[
      {title:'Write a one-task specification',text:'Choose one concrete goal: write a page, run a particular Linux application, or read a sensor. Check the software requirements against the maker documentation.',device:'pocketmage'},
      {title:'Confirm the exact configuration',text:'Check the processor, memory, display and included modules. Save the configuration name together with the maker’s current status.',device:'mecha-comet'},
      {title:'Plan a first-session test',text:'When hardware is available, start with a small file: create it, save it, restart and recover it. Then check how you copy it to another computer.',device:'cardputer-zero'}
    ],
    sourceNote:'These are project comparisons rather than current-stock recommendations. Delivery and final software support must be confirmed with the maker.'
  },
  {
    slug:'build', title:'Choose a programmable hardware project', eyebrow:'BUILD & CODE',
    summary:'Pick the assembly work you want: solder a console, assemble a game kit, or modify a watch.',
    intro:'Choose the assembly work and programming environment that fit your project. Check what is in the box and whether the first step is soldering, assembly or programming.',
    picks:[
      {slug:'nibble',reason:'You want to learn soldering',detail:'A small games-console kit with a 128 × 128 colour screen. Budget for soldering tools and AAA alkaline batteries.'},
      {slug:'byteboi-2-0',reason:'You want an assembly-and-coding project',detail:'A handheld console kit with CircuitBlocks support and an included LiPo battery. Use the 2.0 instructions.'},
      {slug:'sensor-watch-pro',reason:'You already have a compatible watch',detail:'A replacement circuit board, not a finished watch. The case, custom display and sensors need separate consideration.'}
    ],
    checks:['Read the included-parts list and the tool list before ordering.','Match the instructions to the exact product revision.','Choose a small first modification you can recognize immediately.'],
    steps:[
      {title:'Lay out the parts and tools',text:'Use the maker’s assembly guide to check the package. Keep batteries disconnected during assembly when the guide instructs you to do so.',device:'nibble'},
      {title:'Get the example working',text:'Build the device using its revision-specific instructions and run the supplied example before making changes.',device:'byteboi-2-0'},
      {title:'Change one thing',text:'Change a game message, display output or watch behavior. Keep a copy of the working example so you can return to it.',device:'sensor-watch-pro'}
    ],
    sourceNote:'Assembly requirements come from the linked maker material. Tool costs, total build time and learning outcomes have not been independently measured.'
  },
  {
    slug:'radio', title:'Match the radio to the experiment', eyebrow:'RADIO EXPERIMENTS',
    summary:'Compare a scriptable USB transceiver, a multi-protocol board and a standalone LoRa pager.',
    intro:'Start with the frequency band and protocol you want to explore. Radio reception, decoding and a useful capture file are separate capabilities; the installed firmware and host tools determine the workflow.',
    picks:[
      {slug:'yard-stick-one',reason:'You want scriptable sub-GHz experiments',detail:'A USB transceiver used with RfCat. It supports specific bands and half-duplex operation, not arbitrary wideband SDR capture.'},
      {slug:'catsniffer-v3',reason:'You want to explore low-power protocols',detail:'A USB board with CC1352P7 and SX1262 radios. Select and flash protocol-specific firmware.'},
      {slug:'the-hacker-pager',reason:'You want an onboard LoRa workflow',detail:'A standalone pager with LoRa capture tools and microSD. The maker listing was sold out at review.'}
    ],
    checks:['Write down the band and protocol of your own test device.','Confirm supported modulation, firmware and capture format.','Include the required host, antenna and storage in your setup.'],
    steps:[
      {title:'Choose a known signal',text:'Use a device you own with a documented band and protocol. Check that the receiver and firmware support that specific combination.',device:'yard-stick-one'},
      {title:'Prepare the correct firmware',text:'Follow the project’s instructions for the exact board revision. A multi-radio board does not run every protocol at the same time.',device:'catsniffer-v3'},
      {title:'Capture a short, repeatable session',text:'Trigger a simple event on your test device. Save a short capture and record the hardware, firmware and settings beside it.',device:'the-hacker-pager'}
    ],
    sourceNote:'Hardware and software support are taken from linked primary sources. Range and capture reliability have not been field tested here.'
  }
];

export const comparisons = [
  {slug:'mesh-handhelds',title:'T-Deck Plus vs. SenseCAP T1000-E',summary:'A keyboard-equipped Meshtastic handheld versus a phone-connected tracker. Compare input, power, GNSS variants and the hardware each setup requires.',devices:['lilygo-t-deck-plus','sensecap-t1000-e']},
  {slug:'rfid-tools',title:'Flipper Zero, Chameleon Ultra & Proxmark3',summary:'Compare a general-purpose handheld, a compact RFID emulator and a host-based research tool. Tag support and optional accessories matter more than overlapping feature lists.',devices:['flipper-zero','chameleon-ultra','proxmark3-rdv4']},
  {slug:'esp32-c5-tools',title:'M5Shark V8 vs. Scout Lite',summary:'Two ESP32-C5 approaches: a touchscreen handheld or a Flipper Zero expansion board. Compare the host requirement, display, power and firmware caveats.',devices:['m5shark-v8-2-4g-5g','scout-lite']}
];
