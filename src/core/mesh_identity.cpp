#include "lilyshark/core/mesh_identity.h"

#include <cstdio>
#include <cstring>

namespace lilyshark {
namespace {

std::uint32_t g_local_node_num = 0;

} // namespace

std::uint32_t deriveMeshtasticNodeNum(std::uint64_t mac) noexcept
{
    std::uint32_t id = static_cast<std::uint32_t>(mac);
    if (id == 0U || id == 0xffffffffU) {
        id = static_cast<std::uint32_t>(mac >> 16U);
    }
    if (id == 0U || id == 0xffffffffU) {
        id = kLilysharkMeshtasticNodeNum;
    }
    return id;
}

std::uint32_t localMeshtasticNodeNum() noexcept
{
    return g_local_node_num == 0U ? kLilysharkMeshtasticNodeNum : g_local_node_num;
}

void setLocalMeshtasticNodeNum(std::uint32_t node_num) noexcept
{
    if (node_num == 0U || node_num == 0xffffffffU) return;
    g_local_node_num = node_num;
}

void formatLocalMeshtasticShortName(char *output, std::size_t capacity) noexcept
{
    if (output == nullptr || capacity == 0U) return;
    std::snprintf(output, capacity, "%04X",
                  static_cast<unsigned>(localMeshtasticNodeNum() & 0xffffU));
}

void formatLocalMeshtasticLongName(char *output, std::size_t capacity) noexcept
{
    if (output == nullptr || capacity == 0U) return;
    char short_name[8]{};
    formatLocalMeshtasticShortName(short_name, sizeof(short_name));
    std::snprintf(output, capacity, "Lilyshark-%s", short_name);
}

} // namespace lilyshark
