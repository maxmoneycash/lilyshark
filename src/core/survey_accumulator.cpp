#include "lilyshark/core/survey_accumulator.h"

namespace lilyshark {

void SurveyAccumulator::reset() noexcept
{
    sources_ = {};
    snapshot_ = {};
}

void SurveyAccumulator::ingest(const FrameRecord &record) noexcept
{
    ++snapshot_.total_frames;
    if (record.raw.rf.crc == CrcStatus::Invalid) {
        ++snapshot_.crc_invalid_frames;
    }

    if (record.raw.rf.hasField(RfFieldSnr) &&
        (!snapshot_.has_best_snr || record.raw.rf.snr_db_x10 > snapshot_.best_snr_db_x10)) {
        snapshot_.has_best_snr = true;
        snapshot_.best_snr_db_x10 = record.raw.rf.snr_db_x10;
    }

    if (record.raw.rf.crc == CrcStatus::Invalid ||
        record.decoded.state == DecodeState::Malformed ||
        !record.decoded.hasField(FieldSource) || record.decoded.source == 0U) {
        return;
    }

    for (std::size_t index = 0; index < snapshot_.unique_sources; ++index) {
        if (sources_[index].protocol == record.decoded.protocol &&
            sources_[index].source == record.decoded.source) {
            return;
        }
    }

    if (snapshot_.unique_sources == sources_.size()) {
        snapshot_.unique_sources_overflowed = true;
        return;
    }

    sources_[snapshot_.unique_sources++] = {record.decoded.protocol, record.decoded.source};
}

} // namespace lilyshark
