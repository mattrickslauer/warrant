export interface TimelineEntry {
  id: string;
  when: string;
  what: string;
  done?: boolean;
}

/** What happened, in order. Days-long jobs read the same as forty-second ones. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="w-timeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {entries.map((e) => (
        <li className="w-timeline__item" key={e.id}>
          <span className={`w-timeline__dot${e.done ? " w-timeline__dot--done" : ""}`} aria-hidden />
          <div>
            <p className="w-timeline__when">{e.when}</p>
            <p className="w-timeline__what">{e.what}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
