#include "lilyshark/shelby/shelby_pointer_decoder.h"

namespace lilyshark {

DecodeResult ShelbyPointerDecoder::decode(const RawFrame &frame, const RadioProfile &profile,
                                          DecodedPacket &output) const noexcept
{
    (void)profile; // A Shelby pointer is profile-independent: it is identified
                   // by its own magic, not by the radio profile in use.

    const std::size_t offset = findShelbyPointer(frame.bytes, frame.captured_length);
    if (offset >= frame.captured_length) {
        return DecodeResult::NoMatch;
    }

    ShelbyPointer pointer{};
    if (decodeShelbyPointer(frame.bytes + offset,
                            static_cast<std::size_t>(frame.captured_length) - offset,
                            pointer) != ShelbyPointerResult::Ok) {
        return DecodeResult::NoMatch;
    }

    output = makeUnknownPacket(frame);
    output.protocol = ProtocolId::Custom;
    output.state = DecodeState::PayloadDecoded;
    // The pointer is cleartext and fully parsed; whether the *blob* it names is
    // encrypted is a separate claim carried in the pointer's flags.
    output.kind = PacketKind::Data;
    output.present_fields = FieldPayload;
    output.payload_offset = static_cast<std::uint16_t>(offset);
    output.payload_length = static_cast<std::uint16_t>(ShelbyPointer::kEncodedSize);
    output.protocol_flags = pointer.flags;

    if (pointer.isEncrypted()) {
        output.attributes |= AttributeEncrypted;
    }
    if (frame.wasTruncated()) {
        output.attributes |= AttributeTruncated;
    }

    return DecodeResult::Matched;
}

bool ShelbyPointerDecoder::extract(const RawFrame &frame, ShelbyPointer &output) noexcept
{
    const std::size_t offset = findShelbyPointer(frame.bytes, frame.captured_length);
    if (offset >= frame.captured_length) {
        return false;
    }
    return decodeShelbyPointer(frame.bytes + offset,
                               static_cast<std::size_t>(frame.captured_length) - offset,
                               output) == ShelbyPointerResult::Ok;
}

} // namespace lilyshark
