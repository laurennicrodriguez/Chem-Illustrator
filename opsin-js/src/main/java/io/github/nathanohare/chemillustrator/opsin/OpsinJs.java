// What the JavaScript build exports: load(data) once with the unpacked data file, then parse(name).
package io.github.nathanohare.chemillustrator.opsin;

import java.io.IOException;

import org.teavm.jso.JSExport;
import org.teavm.jso.typedarrays.Int8Array;

public final class OpsinJs {
	private OpsinJs() {}

	public static void main(String[] args) {}

	/** Takes the data file's bytes (already decompressed). Returns "" or what went wrong. */
	@JSExport
	public static String load(Int8Array data) {
		try {
			OpsinData.load(data.toJavaArray());
			return "";
		} catch (IOException e) {
			return e.getMessage();
		}
	}

	/** See Opsin.parse. */
	@JSExport
	public static String parse(String name) {
		return Opsin.parse(name);
	}
}
