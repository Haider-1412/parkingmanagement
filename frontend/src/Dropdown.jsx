import React, { useEffect, useId, useRef, useState } from "react";
import "./dropdown.css";

export default function Dropdown({
  label, options, name, value, defaultValue, onChange, disabled, className = "",
}) {
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const [storedValue, setStoredValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const [active, setActive] = useState(0);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === (value ?? storedValue)));
  const selected = options[selectedIndex];
  const unavailable = disabled || !selected;

  useEffect(() => {
    if (!open) return;
    function closeOutside(event) {
      if (!root.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    const menu = list.current;
    const option = menu?.children[active];
    if (!open || !option) return;
    const bottom = option.offsetTop + option.offsetHeight;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [active, open]);

  function showOptions(index) {
    const bounds = trigger.current.getBoundingClientRect();
    const roomBelow = window.innerHeight - bounds.bottom;
    setOpensUp(roomBelow < Math.min(224, options.length * 40 + 8) && bounds.top > roomBelow);
    setActive(index);
    setOpen(true);
  }

  function choose(index) {
    const option = options[index];
    if (!option) return;
    setStoredValue(option.value);
    setOpen(false);
    trigger.current.focus({ preventScroll: true });
    onChange?.(option.value);
  }

  function onKeyDown(event) {
    switch (event.key) {
      case "Tab":
        setOpen(false);
        break;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        if (open) {
          setActive(Math.max(0, Math.min(options.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
        } else showOptions(selectedIndex);
        break;
      case "Home":
      case "End":
        event.preventDefault();
        showOptions(event.key === "Home" ? 0 : options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(active);
        else showOptions(selectedIndex);
        break;
    }
  }

  return <div className={`dropdown ${className}`.trim()} ref={root}>
    <span className="dropdown-label" id={id + "-label"}>{label}</span>
    {name && <input name={name} type="hidden" value={selected?.value ?? ""} disabled={disabled} />}
    <button type="button" role="combobox" className="dropdown-trigger" ref={trigger}
      aria-labelledby={id + "-label"} aria-haspopup="listbox" aria-expanded={open && !unavailable}
      aria-controls={open && !unavailable ? id + "-list" : undefined}
      aria-activedescendant={open && !unavailable ? id + "-option-" + active : undefined}
      disabled={unavailable} onKeyDown={onKeyDown}
      onClick={() => {
        if (open) setOpen(false);
        else showOptions(selectedIndex);
      }}>
      <span>{selected?.label ?? "No options available"}</span><span className="dropdown-chevron" aria-hidden="true" />
    </button>
    {open && !unavailable && <ul id={id + "-list"} role="listbox" aria-labelledby={id + "-label"}
      className="dropdown-options" data-placement={opensUp ? "above" : "below"}
      ref={list} onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, index) => <li key={option.value} id={id + "-option-" + index} role="option"
        aria-selected={index === selectedIndex} data-active={index === active} onClick={() => choose(index)}>
        {option.label}
      </li>)}
    </ul>}
  </div>;
}
