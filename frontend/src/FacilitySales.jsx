import React, { useState } from "react";
import { PageHeading, WorkspaceIcon } from "./WorkspaceShell.jsx";
import { localDateTime, visitTime } from "./VisitDetails.jsx";
import { useLiveData } from "./useLiveData.js";
import "./dashboard.css";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const hourLabel = (hour) => String(hour).padStart(2, "0") + ":00";
const saleHour = (sale) => Number(localDateTime(sale.paid_at).slice(11, 13));
const total = (sales) => sales.reduce((sum, sale) => sum + Math.round(Number(sale.amount) * 100), 0) / 100;

export default function FacilitySales({ facilities, request }) {
  const [facilityId, setFacilityId] = useState("");
  const url = "/api/facility-manager/sales" + (facilityId ? "?facility_id=" + encodeURIComponent(facilityId) : "");
  const { data, error } = useLiveData(request, url);
  const [selectedHour, setSelectedHour] = useState(null);
  const [focusedHour, setFocusedHour] = useState(null);
  const sales = data?.sales || [];
  const hourly = Array.from({ length: 24 }, (_, hour) => total(sales.filter((sale) => saleHour(sale) === hour)));
  const peak = Math.max(1, ...hourly);
  const shownHour = focusedHour ?? selectedHour;
  const shownSales = selectedHour === null ? sales : sales.filter((sale) => saleHour(sale) === selectedHour);

  return <section className="facility-sales">
    <PageHeading title="Facility dashboard" description="Today's recorded payments across your facilities."
      action={<label className="dashboard-facility">Facility
        <select value={facilityId} onChange={(event) => { setSelectedHour(null); setFacilityId(event.target.value); }}>
          <option value="">All facilities</option>
          {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
        </select>
      </label>} />
    {error && <p className="driver-feedback error" role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading dashboard…</p>}
    {data && <>
      <div className="dashboard-detail">
        <section className="panel sales-chart">
          <div className="sales-heading">
            <div><h2>Sales by hour</h2><p>Pakistan Standard Time</p></div>
            <strong className="sales-readout">{shownHour === null ? "Today" : hourLabel(shownHour)}
              <span>{money.format(shownHour === null ? total(sales) : hourly[shownHour])}</span>
            </strong>
          </div>
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
        </section>
        <div className="sales-side">
          <article className="panel hover-card dashboard-metric metric-feature sales-total">
            <span className="metric-icon"><WorkspaceIcon name="report" /></span>
            <h2>Sales today</h2><strong key={total(sales)}>{money.format(total(sales))}</strong>
            <p>{sales.length} recorded {sales.length === 1 ? "payment" : "payments"}</p>
          </article>
          <section className="panel sales-list">
            <div className="sales-heading">
              <div><h2>Recorded payments</h2><p>{selectedHour === null ? "Today" : hourLabel(selectedHour) + " hour"} · {shownSales.length}</p></div>
              {selectedHour !== null && <button type="button" onClick={() => setSelectedHour(null)}>Show all</button>}
            </div>
            {shownSales.length ? <ul key={selectedHour ?? "all"}>{shownSales.map((sale) => <li key={sale.id}>
              <div><strong>{sale.reference}</strong><small>{sale.facility} · {sale.plate}</small></div>
              <div><strong>{money.format(Number(sale.amount))}</strong><small>{localDateTime(sale.paid_at).slice(11)} PKT</small></div>
            </li>)}</ul> : <p>No payments recorded for this period.</p>}
          </section>
        </div>
      </div>
      <p className="dashboard-updated">Last updated {visitTime(data.as_of)} PKT · Refreshes every 10 seconds</p>
    </>}
  </section>;
}
