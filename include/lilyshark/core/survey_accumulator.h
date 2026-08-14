#pragma once

#include "lilyshark/core/frame_store.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace lilyshark {

inline constexpr std::size_t kSurveySourceCapacity = 32U;

struct SurveySnapshot {
    std::uint64_t total_frames = 0;
    std::uint64_t crc_invalid_frames = 0;
    std::size_t unique_sources = 0;
    bool unique_sources_overflowed = false;
    bool has_best_snr = false;
    std::int16_t best_snr_db_x10 = 0;
};

class SurveyAccumulator
{
  public:
    void reset() noexcept;
    void ingest(const FrameRecord &record) noexcept;

    const SurveySnapshot &snapshot() const noexcept { return snapshot_; }

  private:
    struct SourceIdentity {
        ProtocolId protocol = ProtocolId::Unknown;
        std::uint32_t source = 0;
    };

    std::array<SourceIdentity, kSurveySourceCapacity> sources_{};
    SurveySnapshot snapshot_{};
};

} // namespace lilyshark
