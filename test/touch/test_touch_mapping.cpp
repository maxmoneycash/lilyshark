#include "lilyshark/device/touch.h"

#include <cassert>
#include <cstdio>

namespace {

void testOfficialLandscapeTransform()
{
    // LILYGO's inclusive controller edges after swap XY + mirror Y.
    const lilyshark::TouchPoint top_left = lilyshark::mapTDeckTouch(240, 0);
    assert(top_left.x == 0);
    assert(top_left.y == 0);

    const lilyshark::TouchPoint bottom_right = lilyshark::mapTDeckTouch(0, 320);
    assert(bottom_right.x == 319);
    assert(bottom_right.y == 239);

    const lilyshark::TouchPoint center = lilyshark::mapTDeckTouch(120, 160);
    assert(center.x == 160);
    assert(center.y == 120);
}

void testCoordinatesStayInsideLvglBounds()
{
    const lilyshark::TouchPoint beyond_panel = lilyshark::mapTDeckTouch(65535, 65535);
    assert(beyond_panel.x == lilyshark::kTDeckTouchWidth - 1);
    assert(beyond_panel.y == 0);

    const lilyshark::TouchPoint zero = lilyshark::mapTDeckTouch(0, 0);
    assert(zero.x == 0);
    assert(zero.y == lilyshark::kTDeckTouchHeight - 1);
}

void testPointMetadataIsPreserved()
{
    const lilyshark::TouchPoint point = lilyshark::mapTDeckTouch(100, 200, 37, 4);
    assert(point.x == 200);
    assert(point.y == 140);
    assert(point.size == 37);
    assert(point.track_id == 4);
    assert(point.pressed);
}

} // namespace

int main()
{
    testOfficialLandscapeTransform();
    testCoordinatesStayInsideLvglBounds();
    testPointMetadataIsPreserved();
    std::puts("touch mapping tests passed");
    return 0;
}
