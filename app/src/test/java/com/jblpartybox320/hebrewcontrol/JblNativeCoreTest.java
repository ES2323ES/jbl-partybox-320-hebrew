package com.jblpartybox320.hebrewcontrol;

import com.jblpartybox320.hebrewcontrol.player.MusicPlayerController.ExternalTrackInfo;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.BassMode;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.LightPreset;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.ParsedPacket;
import com.jblpartybox320.hebrewcontrol.update.GithubAutoUpdater;
import com.jblpartybox320.hebrewcontrol.update.SpeakerFirmwareUpdater;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class JblNativeCoreTest {

    @Test
    public void harmanLightshowFrameRoundTripsBidirectionally() {
        byte[] packet = JblProtocol.encodeLightshowPacket(
                true,
                LightPreset.NEON,
                0x1B,
                88,
                14,
                "#00F0FF",
                "#E838FF",
                true,
                false
        );
        assertEquals((byte) 0xAA, packet[0]);
        assertEquals(JblProtocol.CMD_LIGHTSHOW, packet[1]);
        assertEquals((byte) 13, packet[2]);
        assertEquals(17, packet.length);

        byte expectedXor = JblProtocol.computeXorChecksum(packet, packet.length - 1);
        assertEquals(expectedXor, packet[packet.length - 1]);

        ParsedPacket parsed = JblProtocol.parseIncomingPacket(packet);
        assertNotNull(parsed);
        assertTrue(parsed.validChecksum);
        assertNotNull(parsed.lightshowState);
        assertTrue(parsed.lightshowState.enabled);
        assertEquals(LightPreset.NEON, parsed.lightshowState.preset);
        assertEquals(0x1B, parsed.lightshowState.zoneMask);
        assertEquals(88, parsed.lightshowState.brightness);
        assertEquals(14, parsed.lightshowState.speedTenths);
        assertEquals("#00F0FF", parsed.lightshowState.primaryHex);
        assertEquals("#E838FF", parsed.lightshowState.secondaryHex);
        assertTrue(parsed.lightshowState.beatSync);
    }

    @Test
    public void speakerInfoReportAndBeatPulsePacketsDecodeAndValidate() {
        byte[] beatFrame = JblProtocol.encodeLightBeatPulsePacket(92, 84, "#FF5A1F", 0x1F);
        assertEquals((byte) 0xAA, beatFrame[0]);
        assertEquals(JblProtocol.CMD_LIGHT_PULSE, beatFrame[1]);
        assertEquals(JblProtocol.computeXorChecksum(beatFrame, beatFrame.length - 1), beatFrame[beatFrame.length - 1]);

        byte[] infoPayload = new byte[]{76, 1, 2, 4, 0, 2};
        byte[] infoFrame = JblProtocol.wrapHarmanFrame(JblProtocol.CMD_SPEAKER_INFO, infoPayload);
        ParsedPacket parsed = JblProtocol.parseIncomingPacket(infoFrame);
        assertNotNull(parsed);
        assertTrue(parsed.validChecksum);
        assertNotNull(parsed.speakerInfo);
        assertEquals(76, parsed.speakerInfo.batteryPercent);
        assertTrue(parsed.speakerInfo.charging);
        assertEquals("2.4.0", parsed.speakerInfo.firmwareVersion);
        assertEquals("Rev A2", parsed.speakerInfo.hardwareRevision);
    }

    @Test
    public void speakerDfuPacketsAndFirmwareComparisonWorkProperly() {
        byte[] begin = JblProtocol.encodeDfuBeginPacket("2.7.0", 1884160, 0x8F4A2C91);
        assertEquals(JblProtocol.CMD_DFU_BEGIN, begin[1]);
        assertEquals(JblProtocol.computeXorChecksum(begin, begin.length - 1), begin[begin.length - 1]);

        byte[] chunk = JblProtocol.encodeDfuChunkPacket(3, new byte[]{1, 2, 3, 4}, 4);
        assertEquals(JblProtocol.CMD_DFU_CHUNK, chunk[1]);
        assertEquals(JblProtocol.computeXorChecksum(chunk, chunk.length - 1), chunk[chunk.length - 1]);

        assertTrue(SpeakerFirmwareUpdater.isFirmwareUpdateAvailable("2.4.0", "2.7.0"));
        assertTrue(SpeakerFirmwareUpdater.isFirmwareUpdateAvailable("Harman SPP v2.5", "2.7.0"));
        assertFalse(SpeakerFirmwareUpdater.isFirmwareUpdateAvailable("2.7.0", "2.7.0"));
        assertFalse(SpeakerFirmwareUpdater.isFirmwareUpdateAvailable("2.8.1", "2.7.0"));
        assertFalse(SpeakerFirmwareUpdater.isFirmwareUpdateAvailable("—", "2.7.0"));
    }

    @Test
    public void equalizerFrameAndExternalTrackTimeFormatWork() {
        float[] gains = new float[]{3.5f, 2.5f, 0.0f, -1.5f, 1.5f, 2.5f, 3.0f};
        byte[] packet = JblProtocol.encodeEqualizerPacket(gains, BassMode.DEEP, true);
        assertEquals((byte) 0xAA, packet[0]);
        assertEquals(JblProtocol.CMD_EQUALIZER, packet[1]);
        assertEquals((byte) 35, packet[3]);
        assertEquals((byte) -15, packet[6]);
        assertEquals((byte) BassMode.DEEP.code, packet[10]);
        assertEquals((byte) 1, packet[11]);

        assertEquals("3:05", ExternalTrackInfo.formatTime(185_000L));
        assertEquals("0:00", ExternalTrackInfo.formatTime(0L));
    }

    @Test
    public void githubSequentialAndSemanticTagComparisonWorks() {
        assertTrue(GithubAutoUpdater.isRemoteReleaseNewer("v8", 7, "0.4.0"));
        assertFalse(GithubAutoUpdater.isRemoteReleaseNewer("v7", 7, "0.4.0"));
        assertFalse(GithubAutoUpdater.isRemoteReleaseNewer("v6", 7, "0.4.0"));
        assertTrue(GithubAutoUpdater.isRemoteReleaseNewer("v0.4.1", 7, "0.4.0"));
        assertFalse(GithubAutoUpdater.isRemoteReleaseNewer("v0.4.0", 7, "0.4.0"));
    }
}
