/*
 * Chem Illustrator's replacement for OPSIN's AutomatonInitialiser (OPSIN is MIT-licensed; see
 * opsin-js/licences/OPSIN-LICENSE.txt). The original loads OPSIN's ready-made automata with Java
 * object serialisation and caches new ones on disk; this one takes them from the data pack
 * (OpsinData), where PackData stored them as plain tables. As in the original, an automaton is
 * only used when its stored regex hash matches the current regex; otherwise it is built from
 * the regex (slow, but correct).
 */
package uk.ac.cam.ch.wwmm.opsin;

import dk.brics.automaton.Automaton;
import dk.brics.automaton.RegExp;
import dk.brics.automaton.RunAutomaton;
import dk.brics.automaton.SpecialOperations;
import io.github.nathanohare.chemillustrator.opsin.OpsinData;

class AutomatonInitialiser {
	private final ResourceGetter resourceGetter;

	AutomatonInitialiser(String resourcePath) {
		resourceGetter = new ResourceGetter(resourcePath);
	}

	RunAutomaton loadAutomaton(String automatonName, String regex, boolean tableize, boolean reverseAutomaton) {
		if (reverseAutomaton) {
			automatonName += "_reversed_";
		}
		String hash = Integer.toString(regex.hashCode());
		if (hash.equals(resourceGetter.getFileContentsAsString(automatonName + "RegexHash.txt"))) {
			RunAutomaton stored = OpsinData.automaton(resourceGetter.getResourcePath() + automatonName + "SerialisedAutomaton.aut");
			if (stored != null) {
				return stored;
			}
		}
		Automaton a = new RegExp(regex).toAutomaton();
		if (reverseAutomaton) {
			SpecialOperations.reverse(a);
		}
		return new RunAutomaton(a, tableize);
	}
}
