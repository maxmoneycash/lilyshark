"""Create a single-file ESP32-S3 factory image after the T-Deck build.

The merge layout follows PlatformIO's upload image list and the GPL-3.0
Meshtastic/ESPEasy factory-image pattern. The resulting image is flashed at
address 0x0; firmware.bin remains the OTA/application image for 0x10000.
"""

import sys
from pathlib import Path

Import("env")  # type: ignore[name-defined]  # Provided by PlatformIO/SCons.


def create_factory_image(source, target, env):
    platform = env.PioPlatform()
    tool_dir = Path(platform.get_package_dir("tool-esptoolpy"))
    sys.path.insert(0, str(tool_dir))

    try:
        import intelhex  # noqa: F401
    except ImportError:
        env.Execute("$PYTHONEXE -m pip install intelhex")

    import esptool

    board = env.BoardConfig()
    output = env.subst("$BUILD_DIR/${PROGNAME}.factory.bin")
    firmware = env.subst("$BUILD_DIR/${PROGNAME}.bin")
    flash_mode = board.get("build.flash_mode", "dio")
    if flash_mode in ("qio", "qout"):
        # A merged image must boot before the ROM has configured QIO flash.
        flash_mode = "dio"

    flash_frequency = str(board.get("build.f_flash", "80000000L")).replace("000000L", "m")
    command = [
        "--chip",
        env.get("BOARD_MCU"),
        "merge_bin",
        "-o",
        output,
        "--flash_mode",
        flash_mode,
        "--flash_freq",
        flash_frequency,
        "--flash_size",
        board.get("upload.flash_size"),
    ]

    for section in env.subst(env.get("FLASH_EXTRA_IMAGES")):
        address, image = section.split(" ", 1)
        command.extend((address, image))
    command.extend(("0x10000", firmware))

    print(f"Generating factory image: {output}")
    esptool.main(command)


env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", create_factory_image)  # type: ignore[name-defined]
