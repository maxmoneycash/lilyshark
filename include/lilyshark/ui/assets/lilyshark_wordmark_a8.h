#pragma once

#include <lvgl.h>

#if LVGL_VERSION_MAJOR != 9
#error "The Lilyshark wordmark descriptor requires LVGL 9"
#endif

#if !defined(LV_DRAW_SW_SUPPORT_A8) || !LV_DRAW_SW_SUPPORT_A8
#error "The Lilyshark wordmark requires LVGL A8 software-draw support"
#endif

#define LILYSHARK_WORDMARK_A8_WIDTH 264U
#define LILYSHARK_WORDMARK_A8_HEIGHT 128U
#define LILYSHARK_WORDMARK_A8_STRIDE 264U
#define LILYSHARK_WORDMARK_A8_DATA_SIZE 33792U
#define LILYSHARK_PINK_RGB888 0xFF4F9DU

#ifdef __cplusplus
extern "C" {
#endif

LV_IMAGE_DECLARE(lilyshark_wordmark_a8);

#ifdef __cplusplus
}
#endif
