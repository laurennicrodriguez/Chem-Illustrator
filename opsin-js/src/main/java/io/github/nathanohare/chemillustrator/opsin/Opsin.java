// Names to structures with OPSIN: the one call the app makes, answering in JSON so the
// JavaScript side needs nothing Java-specific.
package io.github.nathanohare.chemillustrator.opsin;

import uk.ac.cam.ch.wwmm.opsin.NameToStructure;
import uk.ac.cam.ch.wwmm.opsin.NameToStructureConfig;
import uk.ac.cam.ch.wwmm.opsin.OpsinResult;
import uk.ac.cam.ch.wwmm.opsin.OpsinWarning;
import uk.ac.cam.ch.wwmm.opsin.SmilesOptions;

public final class Opsin {
	private static final char[] HEX = "0123456789abcdef".toCharArray();
	private static NameToStructure nts;
	private static NameToStructureConfig config;

	private Opsin() {}

	/**
	 * Reads one name. Returns {"ok":true,"smiles":...,"warnings":[...]} or {"ok":false,"message":...}.
	 * The SMILES carries the CXSMILES extras that matter for a drawing (attachment points of
	 * substituent names like "phenyl" as labelled * atoms, polymer brackets, and/or-stereo groups),
	 * but not OPSIN's locants.
	 */
	public static String parse(String name) {
		try {
			if (!OpsinData.loaded()) return fail("The name reader's data has not been loaded.");
			if (nts == null) {
				nts = NameToStructure.getInstance();
				config = new NameToStructureConfig();
				config.setAllowRadicals(true);
				config.setOutputRadicalsAsWildCardAtoms(true);
				config.setDetailedFailureAnalysis(true);
				config.setWarnRatherThanFailOnUninterpretableStereochemistry(true);
			}
			OpsinResult r = nts.parseChemicalName(name, config);
			if (r.getStatus() == OpsinResult.OPSIN_RESULT_STATUS.FAILURE) return fail(r.getMessage());
			String smiles = r.getSmiles(SmilesOptions.CXSMILES_ATOM_LABELS | SmilesOptions.CXSMILES_POLYMERS | SmilesOptions.CXSMILES_ENHANCED_STEREO);
			if (smiles == null) return fail("OPSIN read the name but could not write the structure.");
			StringBuilder b = new StringBuilder("{\"ok\":true,\"smiles\":");
			quote(b, smiles);
			b.append(",\"warnings\":[");
			boolean first = true;
			for (OpsinWarning w : r.getWarnings()) {
				if (!first) b.append(',');
				first = false;
				quote(b, w.getMessage());
			}
			if (r.getStatus() == OpsinResult.OPSIN_RESULT_STATUS.WARNING && first && r.getMessage() != null && !r.getMessage().isEmpty()) {
				quote(b, r.getMessage());
			}
			return b.append("]}").toString();
		} catch (Throwable t) {
			String m = t.getMessage();
			return fail(m == null || m.isEmpty() ? t.getClass().getName() : m);
		}
	}

	private static String fail(String message) {
		StringBuilder b = new StringBuilder("{\"ok\":false,\"message\":");
		quote(b, message == null ? "" : message);
		return b.append('}').toString();
	}

	static void quoteTo(StringBuilder b, String s) { quote(b, s); }

	private static void quote(StringBuilder b, String s) {
		b.append('"');
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			switch (c) {
			case '"': b.append("\\\""); break;
			case '\\': b.append("\\\\"); break;
			case '\n': b.append("\\n"); break;
			case '\r': b.append("\\r"); break;
			case '\t': b.append("\\t"); break;
			default:
				if (c < 0x20) b.append("\\u00").append(HEX[c >> 4]).append(HEX[c & 15]);
				else b.append(c);
			}
		}
		b.append('"');
	}
}
