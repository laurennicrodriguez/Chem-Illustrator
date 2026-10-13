// OPSIN's data files (word lists, grammar and ready-made automata), packed into one file by
// PackData and handed over in one piece by the app, so nothing is read from disk or the network.
package io.github.nathanohare.chemillustrator.opsin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import dk.brics.automaton.RunAutomaton;
import dk.brics.automaton.RunAutomatonData;

public final class OpsinData {
	/** Where OPSIN looks for its files; names in the pack are relative to this. */
	public static final String ROOT = "uk/ac/cam/ch/wwmm/opsin/resources/";
	static final byte[] MAGIC = { 'O', 'P', 'S', 'D' };
	static final int VERSION = 1;
	static final int FILE = 0, AUTOMATON = 1;

	private static byte[] pack;
	/** name -> { kind, offset, length } */
	private static final Map<String, int[]> entries = new HashMap<>();

	private OpsinData() {}

	public static boolean loaded() { return pack != null; }

	/** Takes the (uncompressed) pack. */
	public static void load(byte[] data) throws IOException {
		if (data.length < 12 || !Arrays.equals(Arrays.copyOf(data, 4), MAGIC)) throw new IOException("Not an OPSIN data pack");
		if (u32(data, 4) != VERSION) throw new IOException("OPSIN data pack has the wrong version");
		int n = u32(data, 8), p = 12;
		entries.clear();
		for (int i = 0; i < n; i++) {
			int nameLen = u16(data, p);
			String name = new String(data, p + 2, nameLen, StandardCharsets.UTF_8);
			p += 2 + nameLen;
			int kind = data[p] & 0xff, len = u32(data, p + 1);
			p += 5;
			if (p + len > data.length) throw new IOException("OPSIN data pack is cut short");
			entries.put(name, new int[] { kind, p, len });
			p += len;
		}
		pack = data;
	}

	private static int[] entry(String path, int kind) {
		if (pack == null || !path.startsWith(ROOT)) return null;
		int[] e = entries.get(path.substring(ROOT.length()));
		return e != null && e[0] == kind ? e : null;
	}

	/** A plain file's bytes, or null. `path` is the full resource path OPSIN asks for. */
	public static byte[] file(String path) {
		int[] e = entry(path, FILE);
		return e == null ? null : Arrays.copyOfRange(pack, e[1], e[1] + e[2]);
	}

	/** A ready-made automaton, or null. */
	public static RunAutomaton automaton(String path) {
		int[] e = entry(path, AUTOMATON);
		if (e == null) return null;
		byte[] d = pack;
		int p = e[1];
		boolean tableize = d[p] != 0;
		int size = u32(d, p + 1), initial = u32(d, p + 5), nPoints = u32(d, p + 9);
		p += 13;
		char[] points = new char[nPoints];
		for (int i = 0; i < nPoints; i++, p += 2) points[i] = (char) u16(d, p);
		boolean[] accept = new boolean[size];
		for (int i = 0; i < size; i++) accept[i] = d[p++] != 0;
		int[] transitions = new int[size * nPoints];
		for (int i = 0; i < transitions.length; i++, p += 4) transitions[i] = u32(d, p);
		return RunAutomatonData.create(size, initial, points, accept, transitions, tableize);
	}

	static int u16(byte[] d, int p) { return (d[p] & 0xff) | (d[p + 1] & 0xff) << 8; }
	static int u32(byte[] d, int p) { return (d[p] & 0xff) | (d[p + 1] & 0xff) << 8 | (d[p + 2] & 0xff) << 16 | (d[p + 3] & 0xff) << 24; }
}
