// Build-time tool (runs on a normal Java, not in the app): packs OPSIN's data files into the one
// compressed file the app loads, turning each serialised automaton into plain tables, then checks
// the pack by reading it back and naming a few compounds with it.
package io.github.nathanohare.chemillustrator.opsin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.zip.GZIPOutputStream;

import dk.brics.automaton.RunAutomaton;
import dk.brics.automaton.RunAutomatonData;

public final class PackData {
	private PackData() {}

	public static void main(String[] args) throws Exception {
		File jar = new File(args[0]);
		File out = new File(args[1]);
		File expected = args.length > 2 ? new File(args[2]) : null;
		List<String> names = new ArrayList<>();
		ByteArrayOutputStream body = new ByteArrayOutputStream();
		int automata = 0;
		try (JarFile jf = new JarFile(jar)) {
			List<JarEntry> list = Collections.list(jf.entries());
			list.sort((a, b) -> a.getName().compareTo(b.getName()));
			for (JarEntry je : list) {
				String name = je.getName();
				if (je.isDirectory() || !name.startsWith(OpsinData.ROOT)) continue;
				String rel = name.substring(OpsinData.ROOT.length());
				byte[] data;
				int kind;
				try (InputStream in = jf.getInputStream(je)) {
					if (rel.endsWith(".aut")) {
						data = automatonTables(RunAutomaton.load(in));
						kind = OpsinData.AUTOMATON;
						automata++;
					} else {
						data = in.readAllBytes();
						kind = OpsinData.FILE;
					}
				}
				byte[] n = rel.getBytes(StandardCharsets.UTF_8);
				le16(body, n.length);
				body.write(n);
				body.write(kind);
				le32(body, data.length);
				body.write(data);
				names.add(rel);
			}
		}
		ByteArrayOutputStream all = new ByteArrayOutputStream();
		all.write(OpsinData.MAGIC);
		le32(all, OpsinData.VERSION);
		le32(all, names.size());
		body.writeTo(all);
		byte[] pack = all.toByteArray();

		check(jar, pack);
		if (expected != null) writeExpected(expected);

		out.getParentFile().mkdirs();
		try (OutputStream o = new GZIPOutputStream(new FileOutputStream(out)) { { def.setLevel(9); } }) {
			o.write(pack);
		}
		System.out.printf("OPSIN data: %d files (%d automata), %.1f MB, %.1f MB compressed -> %s%n",
				names.size(), automata, pack.length / 1e6, out.length() / 1e6, out);
	}

	private static byte[] automatonTables(RunAutomaton a) throws IOException {
		ByteArrayOutputStream b = new ByteArrayOutputStream();
		b.write(RunAutomatonData.tableized(a) ? 1 : 0);
		char[] points = RunAutomatonData.points(a);
		boolean[] accept = RunAutomatonData.accept(a);
		int[] tr = RunAutomatonData.transitions(a);
		le32(b, RunAutomatonData.size(a));
		le32(b, RunAutomatonData.initial(a));
		le32(b, points.length);
		for (char c : points) le16(b, c);
		for (boolean x : accept) b.write(x ? 1 : 0);
		for (int t : tr) le32(b, t);
		return b.toByteArray();
	}

	/** Reads the pack back: every automaton must match the original, and OPSIN must work from it. */
	private static void check(File jar, byte[] pack) throws Exception {
		OpsinData.load(pack);
		try (JarFile jf = new JarFile(jar)) {
			for (JarEntry je : Collections.list(jf.entries())) {
				if (!je.getName().endsWith(".aut")) continue;
				RunAutomaton want;
				try (InputStream in = jf.getInputStream(je)) { want = RunAutomaton.load(in); }
				RunAutomaton got = OpsinData.automaton(je.getName());
				if (got == null
						|| RunAutomatonData.size(got) != RunAutomatonData.size(want)
						|| RunAutomatonData.initial(got) != RunAutomatonData.initial(want)
						|| RunAutomatonData.tableized(got) != RunAutomatonData.tableized(want)
						|| !Arrays.equals(RunAutomatonData.points(got), RunAutomatonData.points(want))
						|| !Arrays.equals(RunAutomatonData.accept(got), RunAutomatonData.accept(want))
						|| !Arrays.equals(RunAutomatonData.transitions(got), RunAutomatonData.transitions(want))) {
					throw new IllegalStateException("Automaton differs after packing: " + je.getName());
				}
			}
		}
		String[][] tests = {
				{ "benzene", "C1=CC=CC=C1" },
				{ "ethanol", "C(C)O" },
				{ "acetic acid", "C(C)(=O)O" },
		};
		for (String[] t : tests) {
			String r = Opsin.parse(t[0]);
			if (!r.contains("\"smiles\":\"" + t[1] + "\"")) throw new IllegalStateException("OPSIN check failed for " + t[0] + ": " + r);
		}
		for (String name : new String[] { "(2R)-butan-2-ol", "4-methoxyphenyl", "rac-(2R,3S)-2,3-dibromobutane", "poly(ethylene)", "2-methyl-1-ol", "ethyl 2-oxo-2H-chromene-3-carboxylate", "tert-butyldimethylsilyl chloride", "xyzzy" }) {
			System.out.println("  " + name + " -> " + Opsin.parse(name));
		}
		System.out.println("OPSIN data check passed");
	}

	/** Names the app's tests read with the JavaScript build; it must give what real Java OPSIN gives. */
	static final String[] TEST_NAMES = {
		"benzene", "ethanol", "acetic acid", "ethyl acetate", "toluene", "pyridine", "furan", "thiophene", "indole",
		"naphthalene", "anthracene", "quinoline", "caffeine", "paracetamol", "aspirin", "cholesterol",
		"(2R)-butan-2-ol", "(2S)-2-aminopropanoic acid", "L-alanine", "(E)-but-2-enoic acid", "(Z)-1,2-dichloroethene",
		"(1R,2S)-2-amino-1-phenylpropan-1-ol", "rac-(2R,3S)-2,3-dibromobutane", "rel-(1R,2S)-cyclohexane-1,2-diol",
		"N-(tert-butoxycarbonyl)-L-proline", "tert-butyldimethylsilyl chloride", "2,4,6-trinitrotoluene",
		"ethyl 2-oxo-2H-chromene-3-carboxylate", "4-methoxyphenyl", "1,4-phenylene", "2-pyridyl", "benzyl bromide",
		"sodium acetate", "triethylamine hydrochloride", "tetrakis(triphenylphosphine)palladium(0)",
		"alpha-D-glucopyranose", "\u03b1-D-glucopyranose", "glycylglycine", "poly(ethylene)", "deuterium oxide",
		"[13C]methane", "2-methylpropan-2-yl 4-(hydroxymethyl)piperidine-1-carboxylate",
		"2-methyl-1-ol", "xyzzy", "Scheme 1", "",
	};

	private static void writeExpected(File f) throws IOException {
		StringBuilder b = new StringBuilder("{\n  \"about\": \"What OPSIN (Java) gives for these names; tests/names.test.ts checks the JavaScript build gives the same. Written by opsin-js PackData.\",\n  \"results\": {\n");
		for (int i = 0; i < TEST_NAMES.length; i++) {
			b.append("    ");
			Opsin.quoteTo(b, TEST_NAMES[i]);
			b.append(": ").append(Opsin.parse(TEST_NAMES[i])).append(i + 1 < TEST_NAMES.length ? ",\n" : "\n");
		}
		b.append("  }\n}\n");
		try (OutputStream o = new FileOutputStream(f)) {
			o.write(b.toString().getBytes(StandardCharsets.UTF_8));
		}
	}

	private static void le16(OutputStream o, int v) throws IOException { o.write(v & 0xff); o.write(v >>> 8 & 0xff); }
	private static void le32(OutputStream o, int v) throws IOException { le16(o, v & 0xffff); le16(o, v >>> 16); }
}
