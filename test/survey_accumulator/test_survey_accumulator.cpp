#include "lilyshark/core/survey_accumulator.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

FrameRecord makeRecord(ProtocolId protocol, std::uint32_t source,
                       CrcStatus crc = CrcStatus::Valid,
                       DecodeState state = DecodeState::HeaderOnly)
{
    FrameRecord record{};
    record.raw.rf.crc = crc;
    record.decoded.protocol = protocol;
    record.decoded.state = state;
    record.decoded.present_fields = FieldSource;
    record.decoded.source = source;
    return record;
}

void testStreamsBeyondFrameStoreWindow()
{
    SurveyAccumulator survey{};
    for (std::size_t index = 0; index < 100U; ++index) {
        FrameRecord record = makeRecord(
            ProtocolId::Meshtastic, static_cast<std::uint32_t>((index % 2U) + 1U));
        record.raw.rf.snr_db_x10 = 300;
        if (index == 10U) {
            record.raw.rf.present_fields |= RfFieldSnr;
            record.raw.rf.snr_db_x10 = -70;
        } else if (index == 70U) {
            record.raw.rf.crc = CrcStatus::Invalid;
        } else if (index == 90U) {
            record.raw.rf.present_fields |= RfFieldSnr;
            record.raw.rf.snr_db_x10 = -25;
        }
        survey.ingest(record);
    }

    const SurveySnapshot &snapshot = survey.snapshot();
    assert(snapshot.total_frames == 100U);
    assert(snapshot.crc_invalid_frames == 1U);
    assert(snapshot.unique_sources == 2U);
    assert(!snapshot.unique_sources_overflowed);
    assert(snapshot.has_best_snr);
    assert(snapshot.best_snr_db_x10 == -25);
}

void testSourceAdmissionAndProtocolIdentity()
{
    SurveyAccumulator survey{};
    survey.ingest(makeRecord(ProtocolId::Meshtastic, 7U, CrcStatus::NotPresent));
    survey.ingest(makeRecord(ProtocolId::Meshtastic, 7U, CrcStatus::Valid));
    survey.ingest(makeRecord(ProtocolId::MeshCore, 7U, CrcStatus::Valid));
    survey.ingest(makeRecord(ProtocolId::Reticulum, 8U, CrcStatus::Unknown));
    survey.ingest(makeRecord(ProtocolId::Meshtastic, 9U, CrcStatus::Invalid));
    survey.ingest(makeRecord(ProtocolId::Meshtastic, 10U, CrcStatus::Valid,
                             DecodeState::Malformed));

    FrameRecord missing_source = makeRecord(ProtocolId::Meshtastic, 11U);
    missing_source.decoded.present_fields = FieldNone;
    survey.ingest(missing_source);
    survey.ingest(makeRecord(ProtocolId::Meshtastic, 0U));

    const SurveySnapshot &snapshot = survey.snapshot();
    assert(snapshot.total_frames == 8U);
    assert(snapshot.crc_invalid_frames == 1U);
    assert(snapshot.unique_sources == 3U);
    assert(!snapshot.has_best_snr);
}

void testSourceCapacityOverflowAndReset()
{
    static_assert(kSurveySourceCapacity >= 32U,
                  "survey source capacity must hold at least 32 identities");

    SurveyAccumulator survey{};
    for (std::size_t index = 0; index < kSurveySourceCapacity; ++index) {
        survey.ingest(makeRecord(ProtocolId::Meshtastic,
                                 static_cast<std::uint32_t>(index + 1U)));
    }
    assert(survey.snapshot().unique_sources == kSurveySourceCapacity);
    assert(!survey.snapshot().unique_sources_overflowed);

    survey.ingest(makeRecord(ProtocolId::Meshtastic, 1U));
    assert(!survey.snapshot().unique_sources_overflowed);

    survey.ingest(makeRecord(ProtocolId::Meshtastic,
                             static_cast<std::uint32_t>(kSurveySourceCapacity + 1U)));
    assert(survey.snapshot().unique_sources == kSurveySourceCapacity);
    assert(survey.snapshot().unique_sources_overflowed);

    survey.reset();
    const SurveySnapshot &reset = survey.snapshot();
    assert(reset.total_frames == 0U);
    assert(reset.crc_invalid_frames == 0U);
    assert(reset.unique_sources == 0U);
    assert(!reset.unique_sources_overflowed);
    assert(!reset.has_best_snr);

    survey.ingest(makeRecord(ProtocolId::Reticulum, 42U));
    assert(survey.snapshot().unique_sources == 1U);
    assert(!survey.snapshot().unique_sources_overflowed);
}

} // namespace

int main()
{
    testStreamsBeyondFrameStoreWindow();
    testSourceAdmissionAndProtocolIdentity();
    testSourceCapacityOverflowAndReset();
    std::puts("survey accumulator tests passed");
    return 0;
}
