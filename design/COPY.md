# Website copy

Write for someone who owns a T-Deck, experiments with radios, or wants to
understand their mesh. Explain what they can inspect and how to get started.

The homepage introduces the tools beside the firmware screens. The Flash page
helps someone install the firmware. Keep the research argument in the whitepaper.

## Voice

- Name the operation: sniff packets, inspect headers, open the hex dump, scan
  the band, change a radio profile, export a PCAP.
- Use technical terms when they help someone understand the tool. Describe
  what the controls do in ordinary language.
- State relevant limits where they matter. USB carries analyzer telemetry;
  Bluetooth carries mesh messaging. A spectrum sweep pauses packet reception.
- Check feature claims against the implementation. Hardware test status,
  protocol decoding, and theoretical radio range are different things.
- Keep labels direct: “Install Lilyshark,” “Verify the download,” “USB flashing
  help.” Give error messages a useful next action.
- Avoid shark puns, lifestyle slogans, market-size pitches, invented hacker
  slang, and claims about being the first or the best.
- Remove sentences such as “Small board. Big bite.” and “Yours to explore.”
  They add no information about the hardware or firmware.

## References reviewed

These are references for evaluating tone, not templates to copy. Reviewed
September 6, 2026.

| Project | Useful observation |
| --- | --- |
| [HackRF](https://greatscottgadgets.com/hackrf/one/) | Identifies the radio, frequency range, operating modes and compatible software immediately. |
| [Bus Pirate](https://buspirate.com/) | Explains a recognizable task: talking to a chip from a terminal. |
| [ESP32 Marauder](https://github.com/justcallmekoko/ESP32Marauder) | States its Wi-Fi/Bluetooth scope and points directly to hardware and firmware documentation. |
| [Flipper Zero](https://flipper.net/) | Connects individual hardware interfaces to things people can do with them. Its mascot voice belongs to Flipper. |
| [WiFi Pineapple](https://shop.hak5.org/products/wifi-pineapple) | Names specific wireless auditing functions. Its enterprise sales language does not suit Lilyshark. |
| [Ratspeak](https://ratspeak.org/) | Makes device selection and installation easy to find. Lilyshark needs its own description as a radio analysis tool. |

Keep Lilyshark's copy original and specific to the code and hardware it ships.
