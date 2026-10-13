// Chem Illustrator: a stand-in for the parts of the Log4j 2 API that OPSIN calls. OPSIN only
// logs debugging detail, which the app has no use for, and the real Log4j looks up classes by
// name at run time, which a JavaScript build cannot do. Everything here does nothing.
package org.apache.logging.log4j;

public interface Logger {
	default boolean isTraceEnabled() { return false; }
	default boolean isDebugEnabled() { return false; }
	default void trace(String message) {}
	default void debug(String message) {}
	default void debug(Object message) {}
	default void debug(String message, Throwable t) {}
	default void info(String message) {}
	default void warn(String message) {}
	default void warn(String message, Throwable t) {}
	default void error(String message) {}
	default void error(String message, Throwable t) {}
}
