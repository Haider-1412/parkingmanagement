import React, { useEffect, useState } from "react";

export default function FacilityOperators({ path, request }) {
  const [operators, setOperators] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = path + "/operators";

  useEffect(() => {
    let active = true;
    request(endpoint).then((data) => {
      if (active) setOperators(data.operators);
    }).catch((failure) => {
      if (active) setError(failure.message);
    });
    return () => { active = false; };
  }, [endpoint]);

  async function run(action) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    run(async () => {
      const data = await request(endpoint, "POST", {
        email: fields.get("email"),
        password: fields.get("password") || null,
      });
      setOperators(data.operators);
      form.reset();
      setNotice("Operator assigned to this facility.");
    });
  }

  function remove(operator) {
    run(async () => {
      await request(endpoint + "/" + operator.id, "DELETE");
      setOperators((previous) => previous.filter((item) => item.id !== operator.id));
      setNotice("Operator access removed from this facility.");
    });
  }

  return <section className="panel facility-operators">
    <h2>Assigned operators</h2>
    <form className="closure-form" onSubmit={submit} autoComplete="off">
      <label>Operator email<input type="email" name="email" required maxLength={254} /></label>
      <label>Password for new account<input type="password" name="password" autoComplete="new-password"
        minLength={8} maxLength={72} /></label>
      <button className="primary" disabled={busy}>Add operator</button>
    </form>
    <p className="operator-help">For an operator you already created, enter their email and leave the password blank.</p>
    {notice && <p className="facility-feedback" role="status">{notice}</p>}
    {error && <p className="facility-feedback error" role="alert">{error}</p>}
    {operators === null && !error && <p role="status">Loading operators…</p>}
    {operators?.length === 0 && <p>No operators assigned.</p>}
    {operators?.length > 0 && <ul className="facility-list">
      {operators.map((operator) => <li key={operator.id}>
        <span>{operator.email}</span>
        <button type="button" disabled={busy} onClick={() => remove(operator)}>Remove access</button>
      </li>)}
    </ul>}
  </section>;
}
