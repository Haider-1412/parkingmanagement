import React, { useState } from "react";
import Dropdown from "./Dropdown.jsx";
import ParkingLoader from "./ParkingLoader.jsx";
import { PageHeading, WorkspaceIcon } from "./WorkspaceShell.jsx";
import { localDateTime } from "./VisitDetails.jsx";
import { useLiveData } from "./useLiveData.js";
import "./dashboard.css";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const updateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit", hour12: true,
});
const hourLabel = (hour) => String(hour).padStart(2, "0") + ":00";
const saleHour = (sale) => Number(localDateTime(sale.paid_at).slice(11, 13));
const total = (sales) => sales.reduce((sum, sale) => sum + Math.round(Number(sale.amount) * 100), 0) / 100;

export default function FacilitySales({ facilities, request, onAddFacility }) {
  const [facilityId, setFacilityId] = useState("");
  const url = "/api/facility-manager/sales" + (facilityId ? "?facility_id=" + encodeURIComponent(facilityId) : "");
  const { data, error } = useLiveData(request, url, facilities.length === 0);
  const [selectedHour, setSelectedHour] = useState(null);
  const [focusedHour, setFocusedHour] = useState(null);
  const sales = data?.sales || [];
  const hourly = Array.from({ length: 24 }, (_, hour) => total(sales.filter((sale) => saleHour(sale) === hour)));
  const peak = Math.max(1, ...hourly);
  const shownHour = focusedHour ?? selectedHour;
  const shownSales = selectedHour === null ? sales : sales.filter((sale) => saleHour(sale) === selectedHour);

  if (!facilities.length) return <section className="facility-sales">
    <PageHeading title="Facility dashboard" />
    <section className="panel facility-dashboard-empty">
      <span className="metric-icon"><WorkspaceIcon name="facilities" /></span>
      <h2>Add your first facility</h2>
      <button className="primary" type="button" onClick={onAddFacility}>Add facility</button>
    </section>
  </section>;

  return <section className="facility-sales">
    <PageHeading title="Facility dashboard"
      action={<Dropdown label="Facility" className="dashboard-facility" value={facilityId}
        onChange={(id) => { setSelectedHour(null); setFacilityId(id); }}
        options={[{ value: "", label: "All facilities" }, ...facilities.map(({ id, name }) => ({ value: id, label: name }))]} />} />
    {error && <p className="driver-feedback error" role="alert">{error}</p>}
    <div className="dashboard-detail">
      <section className="panel sales-chart">
        <div className="sales-heading">
          <div><h2>Sales by hour</h2><p>Pakistan Standard Time</p></div>
          <strong className="sales-readout">{shownHour === null ? "Today" : hourLabel(shownHour)}
            <span>{data ? money.format(shownHour === null ? total(sales) : hourly[shownHour]) : "—"}</span>
          </strong>
        </div>
        {data ? <>
        <div className="sales-bars" role="group" aria-label="Hourly sales. Select an hour to filter the payments.">
          {hourly.map((amount, hour) => <button key={hour} type="button" className="sales-hour"
            aria-label={hourLabel(hour) + ", " + money.format(amount)}
            aria-pressed={selectedHour === hour}
            onMouseEnter={() => setFocusedHour(hour)} onMouseLeave={() => setFocusedHour(null)}
            onFocus={() => setFocusedHour(hour)} onBlur={() => setFocusedHour(null)}
            onClick={() => setSelectedHour(selectedHour === hour ? null : hour)}>
            <span className="sales-bar-fill" style={{ "--bar-height": (amount / peak * 100) + "%" }} />
          </button>)}
        </div>
        <div className="sales-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        </> : error ? <p>Sales are temporarily unavailable.</p> : <ParkingLoader label="Loading sales…" />}
      </section>
      <div className="sales-side">
        <article className="panel hover-card dashboard-metric metric-feature sales-total">
          <span className="metric-icon"><WorkspaceIcon name="report" /></span>
          <h2>Sales today</h2><strong key={data ? total(sales) : "pending"}>{data ? money.format(total(sales)) : "—"}</strong>
        </article>
        <section className="panel sales-list">
          <div className="sales-heading">
            <div><h2>Recorded payments</h2><p>{selectedHour === null ? "Today" : hourLabel(selectedHour) + " hour"}{data && " · " + shownSales.length}</p></div>
            {selectedHour !== null && <button type="button" onClick={() => setSelectedHour(null)}>Show all</button>}
          </div>
          {shownSales.length ? <ul key={selectedHour ?? "all"}>{shownSales.map((sale) => <li key={sale.id}>
            <div><strong>{sale.reference}</strong><small>{sale.facility} · {sale.plate}</small></div>
            <div><strong>{money.format(Number(sale.amount))}</strong><small>{localDateTime(sale.paid_at).slice(11)} PKT</small></div>
          </li>)}</ul> : data && <p>No payments recorded for this period.</p>}
        </section>
      </div>
    </div>
    {data?.as_of && <p className="dashboard-updated">Updated {updateTime.format(new Date(data.as_of))} PKT</p>}
  </section>;
}
