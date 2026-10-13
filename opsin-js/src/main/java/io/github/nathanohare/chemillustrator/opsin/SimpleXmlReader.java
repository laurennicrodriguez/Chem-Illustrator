// A small XML reader for OPSIN's own data files, offering the part of the standard StAX
// interface that OPSIN uses. OPSIN normally uses Woodstox, which is far bigger and finds its
// parts by name at run time, which a JavaScript build cannot do. OPSIN's files are plain:
// elements, attributes, text, comments, a DOCTYPE line and the five standard entities.
package io.github.nathanohare.chemillustrator.opsin;

import java.util.ArrayList;
import java.util.List;

import javax.xml.namespace.NamespaceContext;
import javax.xml.namespace.QName;
import javax.xml.stream.Location;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;

public final class SimpleXmlReader implements XMLStreamReader {
	private static final String[] NONE = new String[0];

	private static final class Event {
		final int type;
		final String name, text;
		final String[] attrNames, attrValues;

		Event(int type, String name, String text, String[] attrNames, String[] attrValues) {
			this.type = type;
			this.name = name;
			this.text = text;
			this.attrNames = attrNames;
			this.attrValues = attrValues;
		}
	}

	private final List<Event> events = new ArrayList<>();
	private int at = 0;

	public SimpleXmlReader(String xml) throws XMLStreamException {
		events.add(new Event(START_DOCUMENT, null, null, NONE, NONE));
		parse(xml);
		events.add(new Event(END_DOCUMENT, null, null, NONE, NONE));
	}

	private void parse(String s) throws XMLStreamException {
		int i = 0, n = s.length(), depth = 0;
		StringBuilder text = new StringBuilder();
		while (i < n) {
			char c = s.charAt(i);
			if (c != '<') {
				int end = s.indexOf('<', i);
				if (end < 0) end = n;
				text.append(decode(s, i, end));
				i = end;
				continue;
			}
			if (s.startsWith("<![CDATA[", i)) {
				int end = find(s, "]]>", i);
				text.append(s, i + 9, end);
				i = end + 3;
				continue;
			}
			if (s.startsWith("<!--", i)) {
				i = find(s, "-->", i + 4) + 3;
				continue;
			}
			if (s.startsWith("<?", i)) {
				i = find(s, "?>", i + 2) + 2;
				continue;
			}
			if (s.startsWith("<!", i)) { // DOCTYPE, possibly with an internal subset in [ ]
				int bracket = 0, j = i + 2;
				for (; j < n; j++) {
					char d = s.charAt(j);
					if (d == '[') bracket++;
					else if (d == ']') bracket--;
					else if (d == '>' && bracket == 0) break;
				}
				if (j >= n) throw error("unfinished <!", i);
				i = j + 1;
				continue;
			}
			flushText(text, depth);
			if (s.startsWith("</", i)) {
				int end = find(s, ">", i);
				events.add(new Event(END_ELEMENT, s.substring(i + 2, end).trim(), null, NONE, NONE));
				depth--;
				i = end + 1;
				continue;
			}
			// start tag
			int j = i + 1;
			while (j < n && !isSpace(s.charAt(j)) && s.charAt(j) != '>' && s.charAt(j) != '/') j++;
			String name = s.substring(i + 1, j);
			if (name.isEmpty()) throw error("element without a name", i);
			List<String> an = new ArrayList<>(), av = new ArrayList<>();
			boolean empty = false;
			while (true) {
				while (j < n && isSpace(s.charAt(j))) j++;
				if (j >= n) throw error("unfinished tag <" + name, i);
				char d = s.charAt(j);
				if (d == '>') { j++; break; }
				if (d == '/' && j + 1 < n && s.charAt(j + 1) == '>') { empty = true; j += 2; break; }
				int k = j;
				while (k < n && s.charAt(k) != '=' && !isSpace(s.charAt(k)) && s.charAt(k) != '>') k++;
				String attr = s.substring(j, k);
				while (k < n && isSpace(s.charAt(k))) k++;
				if (k >= n || s.charAt(k) != '=') throw error("attribute " + attr + " has no value", j);
				k++;
				while (k < n && isSpace(s.charAt(k))) k++;
				char q = k < n ? s.charAt(k) : 0;
				if (q != '"' && q != '\'') throw error("attribute " + attr + " is not quoted", k);
				int end = s.indexOf(q, k + 1);
				if (end < 0) throw error("unfinished attribute " + attr, k);
				an.add(attr);
				av.add(decode(s, k + 1, end));
				j = end + 1;
			}
			events.add(new Event(START_ELEMENT, name, null, an.toArray(NONE), av.toArray(NONE)));
			if (empty) events.add(new Event(END_ELEMENT, name, null, NONE, NONE));
			else depth++;
			i = j;
		}
		flushText(text, depth);
	}

	private void flushText(StringBuilder text, int depth) {
		if (text.length() == 0) return;
		if (depth > 0) events.add(new Event(CHARACTERS, null, text.toString(), NONE, NONE));
		text.setLength(0);
	}

	private static boolean isSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

	private static int find(String s, String what, int from) throws XMLStreamException {
		int k = s.indexOf(what, from);
		if (k < 0) throw error("missing " + what, from);
		return k;
	}

	private static XMLStreamException error(String what, int at) {
		return new XMLStreamException("XML error at character " + at + ": " + what);
	}

	/** Text with the standard entities and character references replaced. */
	static String decode(String s, int from, int to) throws XMLStreamException {
		int amp = s.indexOf('&', from);
		if (amp < 0 || amp >= to) return s.substring(from, to);
		StringBuilder b = new StringBuilder(to - from);
		int i = from;
		while (i < to) {
			char c = s.charAt(i);
			if (c != '&') { b.append(c); i++; continue; }
			int semi = s.indexOf(';', i);
			if (semi < 0 || semi >= to) throw error("unfinished entity", i);
			String e = s.substring(i + 1, semi);
			switch (e) {
			case "lt": b.append('<'); break;
			case "gt": b.append('>'); break;
			case "amp": b.append('&'); break;
			case "quot": b.append('"'); break;
			case "apos": b.append('\''); break;
			default:
				if (e.startsWith("#x") || e.startsWith("#X")) b.appendCodePoint(Integer.parseInt(e.substring(2), 16));
				else if (e.startsWith("#")) b.appendCodePoint(Integer.parseInt(e.substring(1)));
				else throw error("unknown entity &" + e + ";", i);
			}
			i = semi + 1;
		}
		return b.toString();
	}

	private Event cur() { return events.get(at); }

	private static String local(String name) {
		int colon = name.indexOf(':');
		return colon < 0 ? name : name.substring(colon + 1);
	}

	// --- the parts of XMLStreamReader that OPSIN uses ---

	@Override
	public int next() throws XMLStreamException {
		if (at >= events.size() - 1) throw new java.util.NoSuchElementException("No more XML");
		return events.get(++at).type;
	}

	@Override
	public boolean hasNext() { return at < events.size() - 1; }

	@Override
	public int getEventType() { return cur().type; }

	@Override
	public String getLocalName() {
		Event e = cur();
		if (e.type != START_ELEMENT && e.type != END_ELEMENT) throw new IllegalStateException("Not at an element");
		return local(e.name);
	}

	@Override
	public int getAttributeCount() {
		if (cur().type != START_ELEMENT) throw new IllegalStateException("Not at a start tag");
		return cur().attrNames.length;
	}

	@Override
	public String getAttributeLocalName(int index) { return local(cur().attrNames[index]); }

	@Override
	public String getAttributeValue(int index) { return cur().attrValues[index]; }

	@Override
	public String getAttributeValue(String namespaceURI, String localName) {
		Event e = cur();
		if (e.type != START_ELEMENT) throw new IllegalStateException("Not at a start tag");
		for (int i = 0; i < e.attrNames.length; i++) {
			if (local(e.attrNames[i]).equals(localName)) return e.attrValues[i];
		}
		return null;
	}

	@Override
	public String getElementText() throws XMLStreamException {
		if (cur().type != START_ELEMENT) throw new XMLStreamException("getElementText needs a start tag");
		StringBuilder b = new StringBuilder();
		while (true) {
			int t = next();
			if (t == CHARACTERS) b.append(cur().text);
			else if (t == END_ELEMENT) return b.toString();
			else throw new XMLStreamException("Element " + local(events.get(at).name) + " holds more than text");
		}
	}

	@Override
	public int nextTag() throws XMLStreamException {
		while (true) {
			int t = next();
			if (t == START_ELEMENT || t == END_ELEMENT) return t;
			if (t == CHARACTERS && !isWhiteSpace()) throw new XMLStreamException("Text where a tag was expected");
		}
	}

	@Override
	public void close() {}

	@Override
	public boolean isStartElement() { return cur().type == START_ELEMENT; }

	@Override
	public boolean isEndElement() { return cur().type == END_ELEMENT; }

	@Override
	public boolean isCharacters() { return cur().type == CHARACTERS; }

	@Override
	public boolean isWhiteSpace() { return cur().type == CHARACTERS && cur().text.trim().isEmpty(); }

	@Override
	public String getText() { return cur().text; }

	@Override
	public boolean hasText() { return cur().type == CHARACTERS; }

	@Override
	public boolean hasName() { return cur().type == START_ELEMENT || cur().type == END_ELEMENT; }

	@Override
	public char[] getTextCharacters() { return cur().text.toCharArray(); }

	@Override
	public int getTextStart() { return 0; }

	@Override
	public int getTextLength() { return cur().text.length(); }

	@Override
	public int getTextCharacters(int sourceStart, char[] target, int targetStart, int length) {
		String t = cur().text;
		int len = Math.min(length, t.length() - sourceStart);
		t.getChars(sourceStart, sourceStart + len, target, targetStart);
		return len;
	}

	@Override
	public void require(int type, String namespaceURI, String localName) throws XMLStreamException {
		if (cur().type != type || (localName != null && !localName.equals(getLocalName()))) {
			throw new XMLStreamException("Unexpected XML event");
		}
	}

	@Override
	public String getAttributeNamespace(int index) { return null; }

	@Override
	public String getAttributePrefix(int index) { return null; }

	@Override
	public String getAttributeType(int index) { return "CDATA"; }

	@Override
	public boolean isAttributeSpecified(int index) { return true; }

	@Override
	public String getNamespaceURI(String prefix) { return null; }

	@Override
	public String getNamespaceURI() { return null; }

	@Override
	public String getPrefix() { return null; }

	@Override
	public int getNamespaceCount() { return 0; }

	@Override
	public String getNamespacePrefix(int index) { return null; }

	@Override
	public String getNamespaceURI(int index) { return null; }

	@Override
	public String getEncoding() { return "UTF-8"; }

	@Override
	public String getVersion() { return "1.0"; }

	@Override
	public boolean isStandalone() { return false; }

	@Override
	public boolean standaloneSet() { return false; }

	@Override
	public String getCharacterEncodingScheme() { return "UTF-8"; }

	@Override
	public String getPITarget() { return null; }

	@Override
	public String getPIData() { return null; }

	@Override
	public Object getProperty(String name) { return null; }

	// Not used by OPSIN; these would need the javax.xml.namespace classes, which the JavaScript
	// build does not have.
	@Override
	public QName getAttributeName(int index) { throw new UnsupportedOperationException(); }

	@Override
	public QName getName() { throw new UnsupportedOperationException(); }

	@Override
	public NamespaceContext getNamespaceContext() { throw new UnsupportedOperationException(); }

	@Override
	public Location getLocation() { throw new UnsupportedOperationException(); }
}
