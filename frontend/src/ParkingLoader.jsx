import React from "react";
import "./parking-loader.css";

export default function ParkingLoader({ label = "Opening your workspace…", fullPage = false }) {
  const Container = fullPage ? "main" : "div";
  return <Container className={fullPage ? "parking-loader parking-loader-page" : "parking-loader"} role="status">
    <div className="parking-loader-scene" aria-hidden="true">
      <div className="parking-loader-bay"><span>P</span></div>
      <div className="parking-loader-lane" />
      <div className="parking-loader-car"><span /></div>
    </div>
    <p>{label}</p>
  </Container>;
}
