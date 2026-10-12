import { useMemo, useState } from "react";
import { elementChildren, getAttr, trimmedText, XElement } from "../core/xml";
import { useApp } from "./context";

interface PersonCard {
  file: string;
  id: string;
  handle: string;
  name: string;
  male: string;
  birthplace: string;
  dob: string;
  degrees: string[];
  medical: number;
  refs: number;
}

interface FactionCard {
  file: string;
  id: string;
  name: string;
  playerVal: string;
  actions: { at: string; children: number }[];
  refs: { file: string; line: number; elId: number; tag: string }[];
}

function child(el: XElement, name: string) {
  return elementChildren(el).find((c) => c.name.toLowerCase() === name.toLowerCase());
}

/** People (Person files, shown in the game's "people" database) and custom factions. */
export function PeopleView({ head }: { head?: React.ReactNode }) {
  const { project, open, game, toast } = useApp();
  const [q, setQ] = useState("");

  const people: PersonCard[] = useMemo(() => {
    const out: PersonCard[] = [];
    for (const path of project.index.filesByKind.get("people") ?? []) {
      const root = project.files.get(path)?.doc?.root;
      if (!root) continue;
      const id = getAttr(root, "id") ?? "";
      const degrees = child(root, "Degrees");
      out.push({
        file: path,
        id,
        handle: getAttr(root, "handle") ?? "",
        name: [getAttr(root, "firstName"), getAttr(root, "lastName")].filter(Boolean).join(" "),
        male: getAttr(root, "isMale") ?? "",
        birthplace: getAttr(child(root, "Birthplace") ?? root, "name") ?? "",
        dob: child(root, "DOB") ? trimmedText(child(root, "DOB")!) : "",
        degrees: degrees ? elementChildren(degrees).map((d) => `${trimmedText(d)}${getAttr(d, "uni") ? ` · ${getAttr(d, "uni")}` : ""}`) : [],
        medical: child(root, "Medical") ? elementChildren(child(root, "Medical")!).length : 0,
        refs: project.index.refs.filter((r) => r.value === id).length,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [project, project.index]);

  const factions: FactionCard[] = useMemo(() => {
    const out: FactionCard[] = [];
    for (const f of project.index.factions.values()) {
      const root = project.files.get(f.file)?.doc?.root;
      const actions = root
        ? elementChildren(root)
            .filter((c) => c.name === "Action")
            .map((a) => ({ at: [getAttr(a, "ValueRequired") ? `value ≥ ${getAttr(a, "ValueRequired")}` : "", getAttr(a, "Flags") ? `flags ${getAttr(a, "Flags")}` : ""].filter(Boolean).join(", ") || "always", children: elementChildren(a).length }))
        : [];
      out.push({
        file: f.file,
        id: f.id,
        name: f.name,
        playerVal: root ? getAttr(root, "playerVal") ?? "0" : "0",
        actions,
        refs: project.index.refs.filter((r) => r.kind === "faction" && r.value === f.id).map((r) => ({ file: r.file, line: r.line, elId: r.elId, tag: r.tag })),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [project, project.index]);

  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const shownPeople = people.filter((p) => match(`${p.name} ${p.handle} ${p.id} ${p.file}`));
  const shownFactions = factions.filter((f) => match(`${f.name} ${f.id} ${f.file}`));

  return (
    <div className="module">
      <div className="module-head">
        <span className="title">People</span>
        {head}
        <span className="meta">
          {people.length} people · {factions.length} factions
        </span>
      </div>
      <div className="panel-tools">
        <input className="hn-input" placeholder="find person or faction…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} style={{ width: 220 }} />
        <span className="grow" />
        {game.status.online && (
          <button className="hn-btn small" title="Reload every People file in the running game" onClick={() => game.reload("People").catch((e) => toast(String(e), "error"))}>
            reload people in game
          </button>
        )}
      </div>
      <div className="module-body people-body">
        <div className="section-title">FACTIONS <span className="msg info">{shownFactions.length}</span></div>
        {!factions.length && <div className="msg info">No custom factions. Add one from New → Faction.</div>}
        <div className="card-grid">
          {shownFactions.map((f) => (
            <div key={f.file} className="card faction" onClick={() => open({ path: f.file })}>
              <div className="card-title">{f.name}</div>
              <div className="msg info">
                id {f.id} · player value {f.playerVal}
              </div>
              <div className="msg info">
                {f.actions.length} rank action{f.actions.length === 1 ? "" : "s"}
                {f.actions.length ? `: ${f.actions.map((a) => a.at).slice(0, 3).join("; ")}${f.actions.length > 3 ? "…" : ""}` : ""}
              </div>
              {f.refs.length > 0 && (
                <ul className="usages compact" onClick={(e) => e.stopPropagation()}>
                  {f.refs.slice(0, 4).map((r, i) => (
                    <li key={i} onClick={() => open({ path: r.file, elId: r.elId })}>
                      {r.file}:{r.line} &lt;{r.tag}&gt;
                    </li>
                  ))}
                  {f.refs.length > 4 && <li className="msg info">+{f.refs.length - 4} more</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
        <div className="section-title">PEOPLE <span className="msg info">{shownPeople.length}</span></div>
        {!people.length && <div className="msg info">No People files. Add one from New → Person. People appear in the game's databases (medical, academic, criminal…).</div>}
        <div className="card-grid">
          {shownPeople.map((p) => (
            <div key={p.file} className="card person" onClick={() => open({ path: p.file })}>
              <div className="card-title">
                {p.name || p.id}
                {p.handle && <span className="msg info"> "{p.handle}"</span>}
              </div>
              <div className="msg info">
                {p.id}
                {p.male ? ` · ${p.male.toLowerCase() === "true" ? "male" : "female"}` : ""}
                {p.birthplace ? ` · ${p.birthplace}` : ""}
                {p.dob ? ` · ${p.dob}` : ""}
              </div>
              {p.degrees.length > 0 && <div className="msg info">{p.degrees.join(" · ")}</div>}
              <div className="msg info">
                {p.medical ? `${p.medical} medical entries · ` : ""}
                {p.refs ? `${p.refs} reference${p.refs === 1 ? "" : "s"}` : "not referenced"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
