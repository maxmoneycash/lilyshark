// Palette and layout from agent/ios6-chat-ui @ 2ae8e70 (kIos6* / kChat*).
// Main no longer carries that chrome. test/ios6_lab freezes these numbers.

(function (global) {
    const Ios6 = global.Ios6 || (global.Ios6 = {});

    Ios6.SCREEN_WIDTH = 320;
    Ios6.SCREEN_HEIGHT = 240;

    Ios6.colors = {
        Backdrop: 0xdbe4f1,
        NavTop: 0x8ba7c7,
        NavBottom: 0x31537c,
        NavEdge: 0x2b486b,
        BlueTop: 0xb9e3ff,
        BlueBottom: 0x68b4f6,
        BlueEdge: 0x5e95c9,
        GrayTop: 0xffffff,
        GrayBottom: 0xd9d9d9,
        GrayEdge: 0xb7b7b7,
        BarTop: 0xcbd3dd,
        BarBottom: 0x81909e,
        BarEdge: 0x69717b,
        InputTop: 0xe1e1e1,
        InputBottom: 0xffffff,
        SendTop: 0x8fc2ff,
        SendBottom: 0x1d58c4,
        SendEdge: 0x3568ba,
        ButtonTop: 0xffffff,
        ButtonBottom: 0xd9e0e8,
        ButtonEdge: 0xa9b2bc,
        ButtonInk: 0x506994,
        Meta: 0x8c97a5,
        Ink: 0x000000,
        White: 0xffffff,
        BadgeTop: 0xf66576,
        BadgeBottom: 0xaf0017,
        BadgeEdge: 0xe9e9e9,
        OlderTop: 0x92b8fb,
        OlderBottom: 0x1a51b7,
        OlderEdge: 0x24406f,
        InputEdge: 0x777777,
        Placeholder: 0xaaaaaa,
        Rule: 0xb8c0cb,
        NetTop: 0xffe6b0,
        NetBottom: 0xf0c060,
        NetEdge: 0xc79b3a,
        SwitchOnTop: 0xb6e38a,
        SwitchOnBottom: 0x5ea31a,
        SwitchOnEdge: 0x3f7a10,
        Pin: 0xc5ccd4,
        Status: 0x000000,
        Chevron: 0x84a0c4,
        Fault: 0xaf0017,
        Lily: 0xff4f9d,
        Lime: 0x66f05a,
        Amber: 0xf2ce58,
    };

    Ios6.layout = {
        ChatTabY: 26,
        ChatTabH: 16,
        ChatRuleY: 44,
        ChatOlderY: 3,
        ChatOlderH: 18,
        ChatOlderBtnX: 4,
        ChatOlderBtnW: 50,
        ChatNewerBtnX: 266,
        ChatNewerBtnW: 50,
        ChatMsgY: 46,
        ChatMetaY: 168,
        ChatSendX: 262,
        ChatSendY: 186,
        ChatSendW: 52,
        ChatSendH: 30,
        StatusH: 12,
        NavH: 28,
        DockH: 52,
    };

    Ios6.SCREEN_ORDER = [
        "lock",
        "home",
        "field",
        "messages",
        "nodes",
        "radio",
        "settings",
        "kit",
    ];
})(window);
