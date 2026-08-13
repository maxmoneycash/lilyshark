#pragma once

#include <lvgl.h>

LV_FONT_DECLARE(font_condensed_12);
LV_FONT_DECLARE(font_condensed_bold_16);
LV_FONT_DECLARE(font_condensed_bold_28);
LV_FONT_DECLARE(font_mono_10);
LV_FONT_DECLARE(font_mono_semibold_12);

namespace lilyshark::theme {

// Hallmark · macrostructure: Workbench · theme: studied-DNA (source: user-supplied T-Deck references) · tone: field instrument · anchor hue: phosphor green
// Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · slop: pass

inline lv_color_t background() { return lv_color_hex(0x07100F); }
inline lv_color_t surface() { return lv_color_hex(0x0B1716); }
inline lv_color_t surface_selected() { return lv_color_hex(0xF0F4EF); }
inline lv_color_t rule() { return lv_color_hex(0x29413F); }
inline lv_color_t grid() { return lv_color_hex(0x17302E); }
inline lv_color_t text() { return lv_color_hex(0xF0F4EF); }
inline lv_color_t text_muted() { return lv_color_hex(0x8D9C98); }
inline lv_color_t lime() { return lv_color_hex(0x66F05A); }
inline lv_color_t cyan() { return lv_color_hex(0x71D8DF); }
inline lv_color_t amber() { return lv_color_hex(0xF2CE58); }
inline lv_color_t fault() { return lv_color_hex(0xF06C65); }
inline lv_color_t focus() { return lv_color_hex(0x1A5BC4); }
inline lv_color_t heat_deep() { return lv_color_hex(0x061A38); }
inline lv_color_t heat_cold() { return lv_color_hex(0x103A78); }
inline lv_color_t heat_mid() { return lv_color_hex(0x1C74B8); }
inline lv_color_t heat_bright() { return lv_color_hex(0x45C7D8); }
inline lv_color_t heat_hot() { return lv_color_hex(0xF6AE43); }
inline lv_color_t heat_peak() { return lv_color_hex(0xFFE36B); }

constexpr lv_coord_t screen_width = 320;
constexpr lv_coord_t screen_height = 240;
constexpr lv_coord_t status_height = 22;
constexpr lv_coord_t inset = 7;
constexpr lv_coord_t space_xs = 4;
constexpr lv_coord_t space_sm = 8;
constexpr lv_coord_t radius = 1;

inline void reset(lv_obj_t * object)
{
    lv_obj_remove_style_all(object);
    lv_obj_clear_flag(object, LV_OBJ_FLAG_SCROLLABLE);
}

inline void fill(lv_obj_t * object, lv_color_t color)
{
    lv_obj_set_style_bg_color(object, color, 0);
    lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
}

inline void style_screen(lv_obj_t * object)
{
    reset(object);
    fill(object, background());
}

inline void style_label(lv_obj_t * object, lv_color_t color, const lv_font_t * font)
{
    lv_obj_set_style_text_color(object, color, 0);
    lv_obj_set_style_text_font(object, font, 0);
    lv_obj_set_style_text_line_space(object, 0, 0);
}

inline lv_obj_t * label(lv_obj_t * parent, const char * value, lv_color_t color = text(),
                        const lv_font_t * font = &font_condensed_12)
{
    lv_obj_t * object = lv_label_create(parent);
    lv_label_set_text(object, value);
    style_label(object, color, font);
    return object;
}

inline lv_obj_t * rect(lv_obj_t * parent, lv_coord_t x, lv_coord_t y, lv_coord_t width,
                       lv_coord_t height, lv_color_t color)
{
    lv_obj_t * object = lv_obj_create(parent);
    reset(object);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_size(object, width, height);
    fill(object, color);
    return object;
}

inline lv_obj_t * rule_line(lv_obj_t * parent, lv_coord_t x, lv_coord_t y, lv_coord_t width,
                            lv_coord_t height = 1, lv_color_t color = rule())
{
    return rect(parent, x, y, width, height, color);
}

} // namespace lilyshark::theme
