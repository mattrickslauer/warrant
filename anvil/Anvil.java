// The anvil — where a driver stops being text that resembles code.
//
//   POST /run  { "kotlin": "<source>", "frames": ["a4c1388f3d215f0226", ...] }
//
//   200 { "ok": true,  "values": [22.4, 22.6, 23.1], "nulls": 0,
//         "unit": "degC", "min": -40.0, "max": 125.0, "id": "...", "ms": 940 }
//   200 { "ok": false, "stage": "lint",    "error": "import java.net.Socket is not permitted" }
//   200 { "ok": false, "stage": "compile", "error": "e: (14, 31): expecting ')'" }
//   200 { "ok": false, "stage": "execute", "error": "IndexOutOfBoundsException at offset 6" }
//
// A REJECTED DRIVER IS A 200, NOT A 500. Compile failure is a normal outcome of Wright's retry
// loop, not a fault in this service, and the error string goes straight back into the next turn
// as context. 5xx is reserved for the anvil itself being broken, which is what lets the loop
// tell "my code was wrong" apart from "the anvil is down".
//
// WHY THIS EXISTS. Every other agent in the fleet returns a verdict, and a wrong verdict sits on
// the record where somebody can argue with it. Wright returns a function that will mint numbers
// unattended, each one filed as `measured` — the strongest provenance class the product has. So
// Wright is the one agent whose output must be executed before it is believed, and gates 1, 2
// and 4 of specs/2026-08-19-wright-design.md §7 are all statements about running code.
//
// RUNNING MODEL-AUTHORED CODE NEEDS A BOUNDARY, AND IT GETS THREE.
//   1. A lint gate BEFORE the compiler. Imports come from an allowlist and the class must
//      declare every member of `Driver`. Cheap, deterministic, and it removes almost the whole
//      attack surface before a compiler ever reads the text.
//   2. No egress and no credentials. This process opens no outbound socket, reads no Firestore
//      and calls no model. It receives source and bytes and returns numbers.
//   3. A hard timeout on execution. A decode that has not returned in 250 ms is abandoned on a
//      daemon thread rather than waited on, so a `while (true)` costs one frame, not the service.
//
// WHY NOT kotlinc. A cold `kotlinc` invocation is ~10s; the compiler running in-process on a
// warm JVM is a fraction of that, which across a four-iteration retry loop is the difference
// between fitting in a demo and not. The compiler is reached by REFLECTION so that this file
// compiles with nothing but a JDK — the Kotlin jars are a runtime concern, resolved below.

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public final class Anvil {

    // ---------------------------------------------------------------- configuration

    static final int PORT = Integer.parseInt(env("ANVIL_PORT", "8099"));

    /** How long one decode may take before it is abandoned. §5, mechanism 3. */
    static final long DECODE_TIMEOUT_MS = Long.parseLong(env("ANVIL_DECODE_TIMEOUT_MS", "250"));

    /** Whole-request ceiling, so a pathological compile cannot pin the single worker. */
    static final long COMPILE_TIMEOUT_MS = Long.parseLong(env("ANVIL_COMPILE_TIMEOUT_MS", "60000"));

    /**
     * Packages a driver may import.
     *
     * Everything a wire format needs and nothing that reaches the world: no java.net, no
     * java.io, no java.lang.reflect, no kotlin.concurrent. `java.util.UUID` is on the list
     * because `Driver` itself is written in terms of it.
     */
    static final List<String> ALLOWED_IMPORTS = List.of(
            "java.nio.", "java.util.", "java.lang.Math", "kotlin.", "ink.warrant.instrument.");

    /** Every member `Driver` declares. A class short of any of them is not a driver. */
    static final List<String> REQUIRED_MEMBERS =
            List.of("id", "label", "produces", "matches", "characteristicFor", "decode");

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    // ---------------------------------------------------------------- the prelude
    //
    // `Driver.kt` imports android.bluetooth, so it cannot be compiled off a handset. The
    // prelude is that file with the Android-only parts removed — DERIVED at startup rather
    // than transcribed, for the same reason wright.py reads the interface off disk instead of
    // pasting it into a prompt: an interface copied by hand drifts away from the one that
    // actually has to compile, and the first sign of it is a driver rejected for a reason
    // nobody can see.

    static final Path DRIVER_KT = Paths.get(env("ANVIL_DRIVER_KT",
            "android/app/src/main/java/ink/warrant/instrument/Driver.kt"));

    static String prelude(String source) {
        String[] lines = source.split("\n", -1);
        StringBuilder out = new StringBuilder();
        boolean skipping = false;
        for (String line : lines) {
            String t = line.strip();
            // The two `internal fun BluetoothGattCharacteristic.…` extensions are helpers for
            // the app, not members of the contract. They are the only Android in the file
            // besides the import.
            if (t.startsWith("internal fun BluetoothGattCharacteristic")) { skipping = true; continue; }
            // Skip the declaration AND its body — a single-expression function runs on to the
            // next line, and leaving that line behind produces a top-level fragment that fails
            // to parse for a reason nobody reading Driver.kt would ever guess at.
            if (skipping) { if (t.isEmpty()) skipping = false; continue; }
            if (t.startsWith("import android.")) continue;
            out.append(line).append('\n');
        }
        return out.toString();
    }

    // ---------------------------------------------------------------- classpath
    //
    // The Kotlin compiler and stdlib are already on this machine, in the Gradle cache the
    // Android build populated. Resolving them from there means the anvil needs no network and
    // no build step of its own. ANVIL_KOTLIN_CP overrides it for a container that ships them.

    /**
     * What the embeddable compiler needs on its loader.
     *
     * `kotlin-compiler-embeddable` relocates its IntelliJ dependencies but NOT kotlinx-coroutines,
     * trove4j or the annotations jar, so all three have to be here or the compiler dies inside
     * `createApplication` with a ClassNotFoundException that says nothing about Kotlin.
     */
    static final String[] WANTED = {
            "kotlin-compiler-embeddable", "kotlin-stdlib", "kotlin-script-runtime", "kotlin-reflect",
            "kotlinx-coroutines-core-jvm", "trove4j", "annotations",
    };

    static String kotlinClasspath() throws IOException {
        String override = System.getenv("ANVIL_KOTLIN_CP");
        if (override != null && !override.isBlank()) return override;
        Path cache = Paths.get(System.getProperty("user.home"), ".gradle", "caches", "modules-2");
        if (!Files.isDirectory(cache)) throw new IOException("no Gradle cache at " + cache
                + "; set ANVIL_KOTLIN_CP to a classpath holding kotlin-compiler-embeddable and kotlin-stdlib");
        Map<String, Path> best = new HashMap<>();
        try (var walk = Files.walk(cache, 8)) {
            walk.filter(p -> p.toString().endsWith(".jar")).forEach(p -> {
                String n = p.getFileName().toString();
                for (String want : WANTED) {
                    // `annotations` is ambiguous in a Gradle cache: com.google.android ships one
                    // too, and picking it makes the compiler die in IR lowering with a message
                    // that names neither jar. Take the JetBrains coordinate or none.
                    if (want.equals("annotations")
                            && !p.toString().contains("org.jetbrains/annotations/")) continue;
                    // The char after the prefix must be a digit, so `kotlin-stdlib-jdk8` is not
                    // mistaken for `kotlin-stdlib`. It sorts higher and carries no Intrinsics,
                    // which surfaces much later as a ClassNotFoundException inside the compiler.
                    if (n.startsWith(want + "-") && !n.contains("sources")
                            && n.length() > want.length() + 1
                            && Character.isDigit(n.charAt(want.length() + 1))) {
                        Path cur = best.get(want);
                        if (cur == null || n.compareTo(cur.getFileName().toString()) > 0) best.put(want, p);
                    }
                }
            });
        }
        if (!best.containsKey("kotlin-compiler-embeddable") || !best.containsKey("kotlin-stdlib"))
            throw new IOException("Gradle cache has no kotlin-compiler-embeddable/kotlin-stdlib; "
                    + "set ANVIL_KOTLIN_CP");
        return best.values().stream().map(Path::toString).collect(Collectors.joining(File_SEP()));
    }

    static String File_SEP() { return System.getProperty("path.separator"); }

    /** What a DRIVER compiles against: the stdlib and the annotations it references, no compiler. */
    static String compileClasspath(String cp) {
        List<String> keep = new ArrayList<>();
        for (String part : cp.split(Pattern.quote(File_SEP())))
            if (part.contains("kotlin-stdlib") || part.contains("annotations-")) keep.add(part);
        return keep.isEmpty() ? cp : String.join(File_SEP(), keep);
    }

    static String stdlibOnly(String cp) {
        for (String part : cp.split(Pattern.quote(File_SEP())))
            if (part.contains("kotlin-stdlib")) return part;
        return cp;
    }

    // ---------------------------------------------------------------- gate 1a: lint

    static final Pattern IMPORT = Pattern.compile("(?m)^\\s*import\\s+([\\w.]+)");

    /** @return the rejection, or null if the source may go to the compiler. */
    static String lint(String kotlin) {
        Matcher m = IMPORT.matcher(kotlin);
        while (m.find()) {
            String imported = m.group(1);
            boolean ok = ALLOWED_IMPORTS.stream().anyMatch(imported::startsWith);
            if (!ok) return "import " + imported + " is not permitted; a driver may import only "
                    + String.join(", ", ALLOWED_IMPORTS);
        }
        List<String> missing = new ArrayList<>();
        for (String member : REQUIRED_MEMBERS) if (!kotlin.contains(member)) missing.add(member);
        if (!missing.isEmpty())
            return "does not implement Driver — missing " + String.join(", ", missing);
        // Two constructs that no wire-format decode has any use for, and that a lint gate can
        // refuse far more cheaply than a sandbox can contain.
        for (String banned : new String[]{"System.exit", "Runtime.getRuntime", "ProcessBuilder",
                                          "java.lang.reflect", "Class.forName", "::class.java"})
            if (kotlin.contains(banned))
                return banned + " is not permitted in a driver";
        return null;
    }

    // ---------------------------------------------------------------- gate 1b: compile

    record Compiled(boolean ok, String error, Path outDir) {}

    static Compiled compile(String preludeSrc, String driverSrc, String cp) throws Exception {
        Path work = Files.createTempDirectory("anvil-");
        Path out = work.resolve("classes");
        Files.createDirectories(out);
        Path preludeFile = work.resolve("Prelude.kt");
        Path driverFile = work.resolve("Candidate.kt");
        Files.writeString(preludeFile, preludeSrc);
        Files.writeString(driverFile, driverSrc);

        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        PrintStream sink = new PrintStream(captured, true, StandardCharsets.UTF_8);

        // Reflection, so this file needs only a JDK to build. The compiler is a runtime dep.
        ClassLoader loader = new URLClassLoader(urls(cp), Anvil.class.getClassLoader());
        Class<?> k2 = Class.forName("org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", true, loader);
        Object compiler = k2.getDeclaredConstructor().newInstance();
        Method exec = k2.getMethod("exec", PrintStream.class, String[].class);

        // -no-stdlib/-no-reflect because there is no Kotlin home here; the jars are named
        // explicitly on -classpath instead, which is the same thing without the warnings.
        String[] args = {
                "-d", out.toString(),
                "-classpath", compileClasspath(cp),
                "-jvm-target", "17",
                "-no-stdlib", "-no-reflect", "-nowarn",
                preludeFile.toString(), driverFile.toString(),
        };
        Object code = exec.invoke(compiler, sink, (Object) args);
        String log = captured.toString(StandardCharsets.UTF_8);

        // A compiler that threw is the ANVIL being broken, and it must not be reported as the
        // driver being wrong — Wright would spend its whole retry budget rewriting correct code.
        for (String line : log.split("\n"))
            if (line.startsWith("exception:") || line.startsWith("error: could not")) {
                System.err.println("--- compiler crash ---\n" + log + "\n---");
                throw new IllegalStateException("kotlin compiler failed: " + line.strip());
            }

        if (!"OK".equals(String.valueOf(code))) {
            // Only the error lines, and with the temp path stripped: the loop feeds this back
            // to the model, and a scratch directory it can never see is noise that costs tokens
            // and invites it to reason about a filesystem.
            System.err.println("--- compile failed ---\n" + log + "\n---");
            String errors = Arrays.stream(log.split("\n"))
                    .filter(l -> l.startsWith("e:") || l.contains("error:"))
                    .map(l -> l.replace(work.toString() + "/", "").replace(work.toString(), ""))
                    .limit(12)
                    .collect(Collectors.joining("\n"));
            return new Compiled(false, errors.isBlank() ? log.strip() : errors, out);
        }
        return new Compiled(true, null, out);
    }

    static URL[] urls(String cp) throws Exception {
        String[] parts = cp.split(Pattern.quote(File_SEP()));
        URL[] u = new URL[parts.length];
        for (int i = 0; i < parts.length; i++) u[i] = Paths.get(parts[i]).toUri().toURL();
        return u;
    }

    // ---------------------------------------------------------------- gates 2 and 3: run

    record Ran(boolean ok, String error, List<Double> values, int nulls,
               String unit, Double min, Double max, String id, String label) {}

    static Ran run(Path classes, String cp, List<byte[]> frames) {
        try {
            List<URL> u = new ArrayList<>(Arrays.asList(urls(cp)));
            u.add(classes.toUri().toURL());
            // Parent is the BOOT loader, not this one: the driver gets the JDK and Kotlin and
            // nothing of the anvil's own.
            try (URLClassLoader loader = new URLClassLoader(u.toArray(new URL[0]), null)) {
                Class<?> driverType = Class.forName("ink.warrant.instrument.Driver", false, loader);
                Object instance = null;
                Class<?> found = null;
                for (String name : classNames(classes)) {
                    Class<?> c;
                    try { c = Class.forName(name, false, loader); } catch (Throwable t) { continue; }
                    if (c.isInterface() || !driverType.isAssignableFrom(c)) continue;
                    // A Kotlin `object` compiles to a class with a static INSTANCE; a `class`
                    // needs a no-arg constructor. Both are idiomatic and both are accepted.
                    try {
                        var inst = c.getField("INSTANCE");
                        instance = inst.get(null);
                    } catch (NoSuchFieldException e) {
                        instance = c.getDeclaredConstructor().newInstance();
                    }
                    found = c;
                    break;
                }
                if (instance == null)
                    return new Ran(false, "compiled, but no class in it implements Driver",
                            List.of(), 0, null, null, null, null, null);

                String unit = null, id = null, label = null;
                Double min = null, max = null;
                try {
                    Object produces = found.getMethod("getProduces").invoke(instance);
                    unit = String.valueOf(produces.getClass().getMethod("getUnit").invoke(produces));
                    min = (Double) produces.getClass().getMethod("getMin").invoke(produces);
                    max = (Double) produces.getClass().getMethod("getMax").invoke(produces);
                    id = String.valueOf(found.getMethod("getId").invoke(instance));
                    label = String.valueOf(found.getMethod("getLabel").invoke(instance));
                } catch (Throwable t) {
                    return new Ran(false, "declared members could not be read: " + t, List.of(), 0,
                            null, null, null, null, null);
                }

                Method decode = found.getMethod("decode", byte[].class);
                List<Double> values = new ArrayList<>();
                int nulls = 0;
                // One executor for the batch. A decode that overruns is abandoned on its daemon
                // thread; the pool is shut down hard afterwards so nothing survives the request.
                ExecutorService pool = Executors.newSingleThreadExecutor(r -> {
                    Thread t = new Thread(r, "anvil-decode");
                    t.setDaemon(true);
                    return t;
                });
                try {
                    for (int i = 0; i < frames.size(); i++) {
                        final byte[] frame = frames.get(i);
                        final Object inst = instance;
                        Future<Object> f = pool.submit(() -> decode.invoke(inst, (Object) frame));
                        try {
                            Object v = f.get(DECODE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                            if (v == null) nulls++; else values.add(((Number) v).doubleValue());
                        } catch (TimeoutException te) {
                            f.cancel(true);
                            return new Ran(false, "decode did not return within " + DECODE_TIMEOUT_MS
                                    + " ms on frame " + i, values, nulls, unit, min, max, id, label);
                        } catch (ExecutionException ee) {
                            Throwable cause = ee.getCause() != null ? ee.getCause() : ee;
                            if (cause.getCause() != null) cause = cause.getCause();
                            return new Ran(false, cause.getClass().getSimpleName()
                                    + (cause.getMessage() == null ? "" : ": " + cause.getMessage())
                                    + " on frame " + i, values, nulls, unit, min, max, id, label);
                        }
                    }
                } finally {
                    pool.shutdownNow();
                }
                return new Ran(true, null, values, nulls, unit, min, max, id, label);
            }
        } catch (Throwable t) {
            return new Ran(false, t.getClass().getSimpleName() + ": " + t.getMessage(),
                    List.of(), 0, null, null, null, null, null);
        }
    }

    static List<String> classNames(Path root) throws IOException {
        List<String> names = new ArrayList<>();
        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path f, BasicFileAttributes a) {
                String s = f.toString();
                if (s.endsWith(".class") && !s.contains("$")) {
                    String rel = root.relativize(f).toString();
                    names.add(rel.substring(0, rel.length() - 6).replace('/', '.').replace('\\', '.'));
                }
                return FileVisitResult.CONTINUE;
            }
        });
        // Candidate classes before the prelude's, so the driver is found without loading the
        // whole prelude first.
        names.sort(Comparator.comparing(n -> n.startsWith("ink.warrant.instrument.Driver") ? 1 : 0));
        return names;
    }

    // ---------------------------------------------------------------- the endpoint

    static String KOTLIN_CP;
    static String PRELUDE;

    public static void main(String[] args) throws Exception {
        if (!Files.exists(DRIVER_KT))
            throw new IOException("no Driver.kt at " + DRIVER_KT.toAbsolutePath()
                    + " — run from the repo root, or set ANVIL_DRIVER_KT");
        PRELUDE = prelude(Files.readString(DRIVER_KT));
        KOTLIN_CP = kotlinClasspath();

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
        // CONCURRENCY 1. One request at a time, deliberately: the compiler is not cheap, and a
        // queue is a far better failure than four compilations fighting over a core.
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.createContext("/health", ex -> respond(ex, 200,
                "{\"ok\":true,\"prelude_lines\":" + PRELUDE.split("\n").length + "}"));
        server.createContext("/run", Anvil::handleRun);
        server.start();
        System.err.println("anvil listening on 127.0.0.1:" + PORT
                + "  (driver interface: " + DRIVER_KT + ")");
        for (String jar : KOTLIN_CP.split(Pattern.quote(File_SEP())))
            System.err.println("  cp " + Paths.get(jar).getFileName());
    }

    static void handleRun(HttpExchange ex) throws IOException {
        long started = System.currentTimeMillis();
        try {
            if (!"POST".equals(ex.getRequestMethod())) { respond(ex, 405, "{\"error\":\"POST only\"}"); return; }
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Object parsed = Json.parse(body);
            if (!(parsed instanceof Map)) { respond(ex, 400, "{\"error\":\"body must be a JSON object\"}"); return; }
            @SuppressWarnings("unchecked") Map<String, Object> req = (Map<String, Object>) parsed;

            Object src = req.get("kotlin");
            if (!(src instanceof String) || ((String) src).isBlank()) {
                respond(ex, 400, "{\"error\":\"kotlin is required\"}"); return;
            }
            List<byte[]> frames = new ArrayList<>();
            Object fr = req.get("frames");
            if (fr instanceof List<?> list)
                for (Object o : list) if (o instanceof String s) frames.add(unhex(s));

            String reject = lint((String) src);
            if (reject != null) { respond(ex, 200, fail("lint", reject, started)); return; }

            Compiled compiled = compile(PRELUDE, (String) src, KOTLIN_CP);
            if (!compiled.ok()) { respond(ex, 200, fail("compile", compiled.error(), started)); return; }

            Ran ran = run(compiled.outDir(), KOTLIN_CP, frames);
            if (!ran.ok()) { respond(ex, 200, fail("execute", ran.error(), started)); return; }

            StringBuilder b = new StringBuilder("{\"ok\":true,\"values\":[");
            for (int i = 0; i < ran.values().size(); i++) {
                if (i > 0) b.append(',');
                b.append(ran.values().get(i));
            }
            b.append("],\"nulls\":").append(ran.nulls())
             .append(",\"unit\":").append(Json.str(ran.unit()))
             .append(",\"min\":").append(ran.min())
             .append(",\"max\":").append(ran.max())
             .append(",\"id\":").append(Json.str(ran.id()))
             .append(",\"label\":").append(Json.str(ran.label()))
             .append(",\"ms\":").append(System.currentTimeMillis() - started).append('}');
            respond(ex, 200, b.toString());
        } catch (Throwable t) {
            // 5xx means THE ANVIL is broken. Everything a driver can do wrong is a 200 above.
            Throwable root = t;
            while (root.getCause() != null && root.getCause() != root) root = root.getCause();
            root.printStackTrace();
            respond(ex, 500, "{\"ok\":false,\"stage\":\"anvil\",\"error\":"
                    + Json.str(root.getClass().getName() + ": " + root.getMessage()) + "}");
        }
    }

    static String fail(String stage, String error, long started) {
        return "{\"ok\":false,\"stage\":\"" + stage + "\",\"error\":" + Json.str(error)
                + ",\"ms\":" + (System.currentTimeMillis() - started) + "}";
    }

    static void respond(HttpExchange ex, int code, String body) throws IOException {
        byte[] out = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(code, out.length);
        ex.getResponseBody().write(out);
        ex.close();
    }

    static byte[] unhex(String s) {
        String h = s.replaceAll("[^0-9a-fA-F]", "");
        byte[] b = new byte[h.length() / 2];
        for (int i = 0; i < b.length; i++)
            b[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return b;
    }

    // ---------------------------------------------------------------- minimal JSON
    //
    // Enough to read {"kotlin": "...", "frames": [...]} and to quote a string safely. The JDK
    // ships no JSON, and one dependency in a service whose whole point is that it has no
    // dependencies would be a poor trade.

    static final class Json {
        private final String s; private int i;
        private Json(String s) { this.s = s; }

        static Object parse(String s) { Json p = new Json(s); p.ws(); Object v = p.value(); return v; }

        private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        private Object value() {
            ws();
            if (i >= s.length()) return null;
            char c = s.charAt(i);
            switch (c) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case 't': i += 4; return Boolean.TRUE;
                case 'f': i += 5; return Boolean.FALSE;
                case 'n': i += 4; return null;
                default: return number();
            }
        }

        private Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            i++; ws();
            if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
            while (i < s.length()) {
                ws(); String k = string(); ws();
                if (i < s.length() && s.charAt(i) == ':') i++;
                m.put(k, value()); ws();
                if (i < s.length() && s.charAt(i) == ',') { i++; continue; }
                if (i < s.length() && s.charAt(i) == '}') { i++; break; }
                break;
            }
            return m;
        }

        private List<Object> array() {
            List<Object> l = new ArrayList<>();
            i++; ws();
            if (i < s.length() && s.charAt(i) == ']') { i++; return l; }
            while (i < s.length()) {
                l.add(value()); ws();
                if (i < s.length() && s.charAt(i) == ',') { i++; continue; }
                if (i < s.length() && s.charAt(i) == ']') { i++; break; }
                break;
            }
            return l;
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++; // opening quote
            while (i < s.length()) {
                char c = s.charAt(i++);
                if (c == '"') break;
                if (c != '\\') { b.append(c); continue; }
                char e = s.charAt(i++);
                switch (e) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                    default: b.append(e);
                }
            }
            return b.toString();
        }

        private Object number() {
            int start = i;
            while (i < s.length() && "-+.eE0123456789".indexOf(s.charAt(i)) >= 0) i++;
            return Double.valueOf(s.substring(start, i));
        }

        static String str(String v) {
            if (v == null) return "null";
            StringBuilder b = new StringBuilder("\"");
            for (char c : v.toCharArray()) {
                switch (c) {
                    case '"': b.append("\\\""); break;
                    case '\\': b.append("\\\\"); break;
                    case '\n': b.append("\\n"); break;
                    case '\r': b.append("\\r"); break;
                    case '\t': b.append("\\t"); break;
                    default:
                        if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                        else b.append(c);
                }
            }
            return b.append('"').toString();
        }
    }
}
