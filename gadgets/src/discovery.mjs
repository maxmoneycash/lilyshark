export const finds = [
  {slug:'lilygo-t-deck-plus',headline:'Your group chat. Off-grid.',text:'A physical keyboard, a LoRa radio, and a reason to leave cell coverage behind.',topic:'Off-grid messaging'},
  {slug:'ggtag',headline:'Program a badge. With sound.',text:'An e-paper badge that accepts updates through audio or USB.',topic:'Unexpected interfaces'},
  {slug:'radiacode-110',headline:'A gamma spectrometer in your pocket.',text:'Make gamma radiation measurable with a portable instrument.',topic:'Pocket science'}
];
export const hooks = {
  'flipper-zero':'A pocket toolbox for RFID, NFC, infrared and sub-GHz experiments.',
  'lilygo-t-deck-plus':'A keyboard you can take off-grid.',
  'ggtag':'An e-paper badge you can program with sound.',
  'radiacode-110':'A pocket instrument for exploring gamma spectra.',
  'pocketmage':'An e-paper computer with a tiny physical keyboard.',
  'sensor-watch-pro':'A new programmable brain for a familiar digital watch.',
  'meowkit':'A tiny screen, programmable apps and hardware to experiment with.',
  'chatter-2-0':'Build a pair of LoRa text messengers.',
  'nibble':'Solder your own handheld, then write games for it.',
  'catsniffer-v3':'Several low-power radio protocols. One USB board.',
  'yard-stick-one':'A scriptable USB radio for sub-GHz experiments.',
  'sensecap-t1000-e':'A screen-free Meshtastic tracker that slips into a pocket.',
  'scout-lite':'Give a Flipper Zero GPS-tagged wireless surveys.',
  'circuitpet':'A virtual pet you can reprogram.',
  'mecha-comet':'A modular Linux handheld, still in development.',
  'kode-dot':'A proposed app-based pocket tool. Check the latest hardware design.'
};
export const collections = [
  {slug:'off-grid',title:'Out of range.',description:'Keyboards, trackers and text messengers for exploring radio links beyond cell coverage.',devices:['lilygo-t-deck-plus','sensecap-t1000-e','chatter-2-0','thinknode-m1'],name:'My off-grid kit',cover:'lilygo-t-deck-plus'},
  {slug:'tiny-computers',title:'Computers got weird.',description:'E-paper, tiny keyboards and modular Linux. Some of the most interesting ideas are still in development.',devices:['pocketmage','mecha-comet','cardputer-zero','kode-dot'],name:'My tiny-computer wishlist',cover:'pocketmage'},
  {slug:'pocket-science',title:'The invisible stuff.',description:'Tools for exploring radio signals, RFID and gamma radiation. Different instruments, different experiments.',devices:['radiacode-110','catsniffer-v3','yard-stick-one','chameleon-ultra'],name:'My pocket science lab',cover:'radiacode-110'},
  {slug:'build-it',title:'Some assembly encouraged.',description:'Programmable watches, messengers and handheld games. Make the hardware part of the project.',devices:['sensor-watch-pro','nibble','chatter-2-0','circuitpet'],name:'My next build pile',cover:'nibble'}
];
