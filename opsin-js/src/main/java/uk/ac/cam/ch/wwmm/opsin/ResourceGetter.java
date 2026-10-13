/*
 * Chem Illustrator's replacement for OPSIN's ResourceGetter (OPSIN is MIT-licensed; see
 * opsin-js/licences/OPSIN-LICENSE.txt). The original reads OPSIN's files from the jar or the
 * working folder with Woodstox and Commons IO, and can write automata back to disk. This one
 * reads them from the data pack already in memory (OpsinData) with SimpleXmlReader, and never
 * writes. The rest of OPSIN is unchanged.
 */
package uk.ac.cam.ch.wwmm.opsin;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;

import io.github.nathanohare.chemillustrator.opsin.OpsinData;
import io.github.nathanohare.chemillustrator.opsin.SimpleXmlReader;

class ResourceGetter {
	private final String resourcePath;

	ResourceGetter(String resourcePath) {
		if (resourcePath.startsWith("/")) {
			resourcePath = resourcePath.substring(1);
		}
		this.resourcePath = resourcePath;
	}

	String getResourcePath() {
		return resourcePath;
	}

	private byte[] bytes(String name) throws IOException {
		if (name == null) {
			throw new IllegalArgumentException("Input to function was null");
		}
		byte[] b = OpsinData.file(resourcePath + name);
		if (b == null) {
			throw new IOException("OPSIN data file is missing: " + resourcePath + name);
		}
		return b;
	}

	XMLStreamReader getXMLStreamReader(String name) throws IOException {
		try {
			return new SimpleXmlReader(new String(bytes(name), StandardCharsets.UTF_8));
		} catch (XMLStreamException e) {
			throw new IOException("Validity exception occurred while reading the XML file with name:" + name, e);
		}
	}

	String getFileContentsAsString(String name) {
		try {
			return new String(bytes(name), StandardCharsets.UTF_8);
		} catch (IOException e) {
			return "";
		}
	}

	InputStream getInputstreamFromFileName(String name) throws IOException {
		return new ByteArrayInputStream(bytes(name));
	}

	OutputStream getOutputStream(String name) throws IOException {
		throw new IOException("OPSIN's data is read-only in Chem Illustrator");
	}
}
