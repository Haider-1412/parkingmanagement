import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DriverWorkspace from "./DriverWorkspace.jsx";
import FacilityWorkspace from "./FacilityWorkspace.jsx";
import OperatorWorkspace from "./OperatorWorkspace.jsx";
import { PreviewControls } from "./WorkspaceShell.jsx";
import { createPreviewData } from "./previewData.js";
import "./app.css";

const roles = { driver: "Driver", manager: "Facility manager", operator: "Parking operator" };

function Preview() {
  const [role, setRole] = useState(() => {
    const requested = new URLSearchParams(location.search).get("role");
    return Object.hasOwn(roles, requested) ? requested : "driver";
  });
  const [sample] = useState(createPreviewData);

  function changeRole(event) {
    const next = event.target.value;
    const url = new URL(location.href);
    url.searchParams.set("role", next);
    history.replaceState(null, "", url);
    setRole(next);
  }

  return <PreviewControls.Provider value={<label className="preview-role">Preview role
    <select value={role} onChange={changeRole}>
      {Object.entries(roles).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
    </select>
  </label>}>
    {role === "driver" && <DriverWorkspace data={sample.driver()} request={sample.request} initialVisit={sample.visit} />}
    {role === "manager" && <FacilityWorkspace initialFacilities={sample.facilities()} request={sample.request} />}
    {role === "operator" && <OperatorWorkspace facilities={sample.facilities()} request={sample.request} />}
  </PreviewControls.Provider>;
}

if (import.meta.env.DEV) createRoot(document.getElementById("root")).render(<Preview />);
