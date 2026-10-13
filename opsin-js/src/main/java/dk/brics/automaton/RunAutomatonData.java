// Chem Illustrator: reads and writes a RunAutomaton's tables as plain numbers. The library's own
// load/store use Java object serialisation, which a JavaScript build cannot do. This class sits in
// the library's package so it can reach the (package-private) tables; the library is unchanged.
package dk.brics.automaton;

public final class RunAutomatonData {
	private RunAutomatonData() {}

	public static int size(RunAutomaton a) { return a.size; }
	public static int initial(RunAutomaton a) { return a.initial; }
	public static char[] points(RunAutomaton a) { return a.points; }
	public static boolean[] accept(RunAutomaton a) { return a.accept; }
	public static int[] transitions(RunAutomaton a) { return a.transitions; }
	public static boolean tableized(RunAutomaton a) { return a.classmap != null; }

	/** A RunAutomaton with the given tables (as written by size(), points() and so on). */
	public static RunAutomaton create(int size, int initial, char[] points, boolean[] accept, int[] transitions, boolean tableize) {
		RunAutomaton a = new RunAutomaton(BasicAutomata.makeEmpty(), false);
		a.size = size;
		a.initial = initial;
		a.points = points;
		a.accept = accept;
		a.transitions = transitions;
		a.classmap = null;
		if (tableize) a.setAlphabet();
		return a;
	}
}
