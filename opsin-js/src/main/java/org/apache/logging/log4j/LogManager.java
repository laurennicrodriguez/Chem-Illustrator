// Chem Illustrator: a stand-in for Log4j 2's LogManager (see Logger.java). Every logger is silent.
package org.apache.logging.log4j;

public final class LogManager {
	private static final Logger SILENT = new Logger() {};

	private LogManager() {}

	public static Logger getLogger(Class<?> c) { return SILENT; }
	public static Logger getLogger(String name) { return SILENT; }
}
