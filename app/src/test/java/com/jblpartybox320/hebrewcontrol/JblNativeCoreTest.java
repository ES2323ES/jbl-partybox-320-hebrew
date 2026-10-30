package com.jblpartybox320.hebrewcontrol;

import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.BassMode;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.LightPreset;
import com.jblpartybox320.hebrewcontrol.update.GithubAutoUpdater;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class JblNativeCoreTest {

    @Test
    public void harmanLightshowFrameHasValidHeaderLengthAndXorChecksum() {
        byte[] packet = JblProtocol.encodeLightshowPacket(
                true,
                LightPreset.NEON,
                0x1F,
                85,
                10,
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
    }

    @Test
    public void equalizerFrameEncodesSevenBandsAndBassMode() {
        float[] gains = new float[]{3.5f, 2.5f, 0.0f, -1.5f, 1.5f, 2.5f, 3.0f};
        byte[] packet = JblProtocol.encodeEqualizerPacket(gains, BassMode.DEEP, true);
        assertEquals((byte) 0xAA, packet[0]);
        assertEquals(JblProtocol.CMD_EQUALIZER, packet[1]);
        assertEquals((byte) 35, packet[3]);
        assertEquals((byte) -15, packet[6]);
        assertEquals((byte) BassMode.DEEP.code, packet[10]);
        assertEquals((byte) 1, packet[11]);
    }

    @Test
    public void githubSequentialAndSemanticTagComparisonWorks() {
        assertTrue(GithubAutoUpdater.isRemoteReleaseNewer("v6", 5, "0.3.0"));
        assertFalse(GithubAutoUpdater.isRemoteReleaseNewer("v5", 5, "0.3.0"));
        assertFalse(GithubAutoUpdater.isRemoteReleaseNewer("v4", 5, "0.3.0"));
        assertTrue(GithubAutoUpdater.isRemoteReleaseNewer("v0.3.1", 5, "0.3.0"));
        assertFalse(GithubAutoUpdater.isRemoteReleaseNewer("v0.3.0", 5, "0.3.0"));
    }
}
