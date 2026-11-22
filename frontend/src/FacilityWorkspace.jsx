import FacilitySales from "./FacilitySales.jsx";
import React, { useEffect, useState } from "react";
import FacilityReport from "./FacilityReport.jsx";
import FacilityOperators from "./FacilityOperators.jsx";
import { PageHeading, WorkspaceIcon, WorkspaceShell } from "./WorkspaceShell.jsx";
import "./facility.css";

const pages = [
  { id: "home", label: "Dashboard" },
  { id: "facilities", label: "Facilities" },
  { id: "layout", label: "Layout editor" },
  { id: "operators", label: "Operators" },
  { id: "report", label: "Facility report" },
];

const facilitiesPath = "/api/facility-manager/facilities";
const emptyFacility = { name: "", address: "", hourly_rate: "", opens_at: null, closes_at: null };
const buildingTool = "building";
const spotTool = "spot";
const cellKey = (cell) => cell.grid_row + ":" + cell.grid_column;

function FacilityForm({ facility = emptyFacility, busy, onSave }) {
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: form.get("name"),
      address: form.get("address"),
      hourly_rate: form.get("hourly_rate"),
      opens_at: form.get("opens_at") || null,
      closes_at: form.get("closes_at") || null,
    });
  }

  return <form className="facility-form" onSubmit={submit}>
    <label>Name<input name="name" defaultValue={facility.name} required maxLength={120} /></label>
    <label>Address<input name="address" defaultValue={facility.address} required maxLength={250} /></label>
    <label>Hourly rate (PKR)<input name="hourly_rate" type="number" min="0" step=".01"
      defaultValue={facility.hourly_rate} required /></label>
    <fieldset>
      <legend>Hours (PKT)</legend>
      <label>Opens<input name="opens_at" type="time" defaultValue={facility.opens_at?.slice(0, 5)} /></label>
      <label>Closes<input name="closes_at" type="time" defaultValue={facility.closes_at?.slice(0, 5)} /></label>
      <small>Leave both blank for 24-hour access.</small>
    </fieldset>
    <button className="primary" disabled={busy}>{facility.id ? "Save details" : "Register facility"}</button>
  </form>;
}

function LayoutEditor({ facility, busy, onSaveLayout, onAddClosure, onRemoveClosure }) {
  const [spots, setSpots] = useState(facility.spots);
  const [buildings, setBuildings] = useState(facility.buildings);
  const [tool, setTool] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dirty, setDirty] = useState(false);
  const tiles = new Map(buildings.map((block) => [cellKey(block), { kind: buildingTool, cell: block }]));
  for (const spot of spots) tiles.set(cellKey(spot), { kind: spotTool, cell: spot });
  const selectedTile = tiles.get(selected);
  const columns = Math.min(40, Math.max(14, ...Array.from(tiles.values(), ({ cell }) => cell.grid_column + 2)));
  const rows = Math.min(30, Math.max(10, ...Array.from(tiles.values(), ({ cell }) => cell.grid_row + 2)));
  const now = Date.now();
  const blocked = new Set(facility.maintenance.filter((window) =>
    Date.parse(window.starts_at) <= now && now < Date.parse(window.ends_at)).map((window) => window.slot_id));

  useEffect(() => {
    setSpots(facility.spots);
    setBuildings(facility.buildings);
    setDirty(false);
  }, [facility.spots, facility.buildings]);

  function place(kind, target, source) {
    const targetKey = cellKey(target);
    if (busy || tiles.has(targetKey)) return;
    if (kind === spotTool) {
      if (source) {
        setSpots(spots.map((spot) => cellKey(spot) === source ? { ...spot, ...target } : spot));
      } else {
        const labels = new Set(spots.map((spot) => spot.label));
        let number = 1;
        while (labels.has("P" + number)) number++;
        setSpots([...spots, { ...target, label: "P" + number }]);
      }
    } else if (kind === buildingTool) {
      setBuildings([...buildings.filter((cell) => cellKey(cell) !== source), target]);
    } else {
      return;
    }
    setDirty(true);
    setSelected(targetKey);
  }

  function beginDrag(event, kind, source) {
    if (busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", kind);
    event.dataTransfer.effectAllowed = source ? "move" : "copy";
    setDragging({ kind, source });
  }

  function removeCell(key) {
    setSpots(spots.filter((spot) => cellKey(spot) !== key));
    setBuildings(buildings.filter((cell) => cellKey(cell) !== key));
    setDirty(true);
    setSelected(null);
  }

  return <div className="editor-rails">
    <div className="layout-shell panel">
    <h2>{facility.name}</h2>
    <div className="layout-toolbar" aria-label="Layout tools">
      <button type="button" disabled={busy} aria-pressed={tool === null} onClick={() => setTool(null)}>Select</button>
      <button type="button" draggable={!busy} onDragStart={(event) => beginDrag(event, spotTool)}
        onDragEnd={() => setDragging(null)} aria-pressed={tool === spotTool}
        disabled={busy} onClick={() => setTool(tool === spotTool ? null : spotTool)}>
        <span className="swatch parking-swatch" /> Parking space
      </button>
      <button type="button" draggable={!busy} onDragStart={(event) => beginDrag(event, buildingTool)}
        onDragEnd={() => setDragging(null)} aria-pressed={tool === buildingTool}
        disabled={busy} onClick={() => setTool(tool === buildingTool ? null : buildingTool)}>
        <span className="swatch building-swatch" /> Building
      </button>
      <button type="button" disabled={busy} aria-pressed={tool === "clear"}
        onClick={() => setTool("clear")}>Clear</button>
      <button type="button" className="primary save-layout"
        disabled={!dirty || busy} onClick={() => onSaveLayout({ spots, buildings })}>Save layout</button>
    </div>
    <div className="layout-scroll">
      <div className="layout-grid" style={{ gridTemplateColumns: "repeat(" + columns + ", var(--cell-size))" }}
        aria-label="Parking layout">
        {Array.from({ length: rows * columns }, (_, index) => {
          const cell = { grid_row: Math.floor(index / columns), grid_column: index % columns };
          const key = cellKey(cell);
          const tile = tiles.get(key);
          const status = tile?.kind === spotTool
            ? blocked.has(tile.cell.id) ? "Closed" : tile.cell.occupied ? "In use" : "Open"
            : null;
          const isSelected = selected === key;
          const name = tile?.kind === spotTool ? tile.cell.label + ", " + status
            : tile ? "Building" : "Empty cell";
          const position = " row " + (cell.grid_row + 1) + ", column " + (cell.grid_column + 1);
          return <button key={key} type="button" className={[
            "grid-cell", tile?.kind || "", status === "Closed" ? "closed" : status === "In use" ? "in-use" : "", isSelected ? "selected" : "",
          ].join(" ")}
            aria-label={name + position} title={name + position} aria-pressed={isSelected}
            draggable={Boolean(tile) && !busy}
            onDragStart={(event) => tile && beginDrag(event, tile.kind, key)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              if (dragging && !tile && !busy) {
                event.preventDefault();
                event.dataTransfer.dropEffect = dragging.source ? "move" : "copy";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging) place(dragging.kind, cell, dragging.source);
              setDragging(null);
            }}
            onClick={() => {
              if (tool === "clear") {
                if (tile && !busy) removeCell(key);
              } else if (tile || !tool) setSelected(key);
              else place(tool, cell);
            }}>
            {status ? <><strong>{tile.cell.label}</strong><small>{status}</small></>
              : tile ? "BLDG" : "\u00b7"}
          </button>;
        })}
      </div>
    </div>
    </div>
    <section className="panel editor-properties">
    <h2>Cell properties</h2>
    {selected ? <p>Row {Number(selected.split(":")[0]) + 1}, column {Number(selected.split(":")[1]) + 1}</p>
      : <p>Select a cell to view its properties.</p>}
    {selected && !selectedTile && <p>Empty cell</p>}
    {selectedTile && <div className="selection-tools">
      {selectedTile.kind === spotTool ? <label>Space label <input value={selectedTile.cell.label}
        maxLength={24} disabled={busy} onChange={(event) => {
          const label = event.target.value;
          setSpots(spots.map((spot) => cellKey(spot) === selected ? { ...spot, label } : spot));
          setDirty(true);
        }} /></label> : <span>Building</span>}
      <button type="button" disabled={busy} onClick={() => removeCell(selected)}>Remove cell</button>
    </div>}
    {selectedTile?.kind === spotTool && selectedTile.cell.id && !dirty &&
      <section className="closures" key={selectedTile.cell.id}>
        <h3>Maintenance closures</h3>
        <form className="closure-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onAddClosure(selectedTile.cell.id, {
            starts_at: form.get("starts_at") + ":00+05:00",
            ends_at: form.get("ends_at") + ":00+05:00",
          });
        }}>
          <label>From (PKT)<input type="datetime-local" name="starts_at" required /></label>
          <label>To (PKT)<input type="datetime-local" name="ends_at" required /></label>
          <button disabled={busy}>Add closure</button>
        </form>
        {facility.maintenance.filter((window) => window.slot_id === selectedTile.cell.id).map((window) =>
          <p key={window.id}>{formatTime(window.starts_at)} to {formatTime(window.ends_at)}{" "}
            <button type="button" disabled={busy} onClick={() => onRemoveClosure(window.id)}>Remove closure</button>
          </p>)}
      </section>}
    </section>
  </div>;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}

export default function FacilityWorkspace({ initialFacilities, request, onSignOut }) {
  const [page, setPage] = useState("home");
  const [facilities, setFacilities] = useState(initialFacilities);
  const [current, setCurrent] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const path = current ? facilitiesPath + "/" + current.id : facilitiesPath;

  async function perform(action, success, refreshLayout = false) {
    setBusy(true);
    setMessage("");
    setFailure("");
    try {
      const record = await action();
      setCurrent((previous) => !refreshLayout && previous?.id === record.id
        ? { ...record, spots: previous.spots, buildings: previous.buildings }
        : record);
      setCreating(false);
      setFacilities((previous) => [...previous.filter((item) => item.id !== record.id), record]
        .sort((a, b) => a.name.localeCompare(b.name)));
      if (success) setMessage(success);
    } catch (error) {
      setFailure(error.message);
    } finally {
      setBusy(false);
    }
  }

  function navigate(next) {
    if (busy || next === page) return;
    setMessage("");
    setFailure("");
    setPage(next);
  }

  function chooseFacility(id, next = page) {
    if (current?.id === id) {
      navigate(next);
      return;
    }
    if (!id) {
      setCurrent(null);
      setFailure("");
      setMessage("");
      return;
    }
    perform(async () => {
      const facility = await request(facilitiesPath + "/" + id);
      setPage(next);
      return facility;
    }, "", true);
  }

  return <WorkspaceShell role="Facility manager" items={pages} page={page} onNavigate={navigate} onSignOut={onSignOut}>
    <section className="facility-workspace">
      {page === "home" ? <FacilitySales facilities={facilities} request={request} /> : <>
      <PageHeading title={pages.find(({ id }) => id === page).label}
        description={{
          facilities: "Manage parking facilities, rates, and operating hours.",
          layout: "Place parking spaces and buildings, edit labels, and schedule closures.",
          operators: "Manage operator access by facility.",
          report: "Review reservations, visits, occupancy, and collected revenue.",
        }[page]}
        action={page === "facilities" && <button disabled={busy} className="primary"
          onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "Add facility"}</button>} />
      {message && <p className="facility-feedback" role="status">{message}</p>}
      {failure && <p className="facility-feedback error" role="alert">{failure}</p>}
      {page === "facilities" && <>
        {creating && <div className="panel"><h2>Register facility</h2><FacilityForm busy={busy} onSave={(body) =>
          perform(() => request(facilitiesPath, "POST", body), "Facility registered.")} /></div>}
        {facilities.length > 0 && <ul className="directory-list manager-facilities">{facilities.map((facility) =>
          <li key={facility.id} className="hover-card">
            <div className="facility-identity">
              <span><WorkspaceIcon name="facilities" /></span>
              <div><strong>{facility.name}</strong><p>{facility.address}</p></div>
            </div>
            <div className="facility-actions"><strong>PKR {facility.hourly_rate}/hr</strong>
              <button type="button" disabled={busy} onClick={() => chooseFacility(facility.id)}>Edit details</button>
              <button type="button" disabled={busy} onClick={() => chooseFacility(facility.id, "layout")}>Layout</button>
            </div>
          </li>)}</ul>}
        {!creating && !facilities.length && <p>No facilities yet.</p>}
        {current && !creating && <div className="panel">
          <h2>{current.name}</h2>
          <FacilityForm key={current.id} facility={current} busy={busy} onSave={(body) =>
            perform(() => request(path, "PUT", body), "Facility details saved.")} />
        </div>}
      </>}
      {page !== "facilities" && (facilities.length ? <label className="manager-facility-picker">Facility
        <select value={current?.id || ""} disabled={busy} onChange={(event) => chooseFacility(event.target.value)}>
          <option value="">Choose a facility</option>
          {facilities.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label> : <div className="panel"><p>Register a facility to use this workspace.</p>
        <button type="button" onClick={() => navigate("facilities")}>Go to facilities</button></div>)}
      </>}
      {current && <React.Fragment key={current.id}>
        <div hidden={page !== "layout"}>
          <LayoutEditor facility={current} busy={busy}
            onSaveLayout={(body) => perform(() => request(path + "/layout", "PUT", body), "Layout saved.", true)}
            onAddClosure={(spotId, body) => perform(() =>
              request(path + "/spots/" + spotId + "/maintenance", "POST", body), "Closure added.")}
            onRemoveClosure={(windowId) => perform(async () => {
              await request(path + "/maintenance/" + windowId, "DELETE");
              return request(path);
            }, "Closure removed.")} />
        </div>
        {page === "operators" && <FacilityOperators path={path} request={request} />}
        {page === "report" && <FacilityReport path={path} request={request} />}
      </React.Fragment>}
    </section>
  </WorkspaceShell>;
}
