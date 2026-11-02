// Explore acquisitions: honest about what is not built yet, and specific about what is coming.

import { Link } from "../router.tsx";

export function Acquire() {
  return (
    <div className="page narrow">
      <div className="eyebrow">Explore acquisitions</div>
      <h1 className="display" style={{ fontSize: 44 }}>
        Find a business worth owning.
      </h1>
      <p className="muted" style={{ fontSize: 18 }}>
        Not open yet. Acquisitions open once businesses here take payments on NEAR, so the numbers
        you search by are real.
      </p>
      <div className="card">
        <h2>What you will be able to do here</h2>
        <ul style={{ paddingLeft: 20, display: "grid", gap: 8, margin: 0 }}>
          <li>
            Set up a buying profile on your own, for your business, or with a group, even the
            customers of a service.
          </li>
          <li>
            Search by kind of business, stage, revenue, profit, asking price and Everstreet's
            valuation estimate.
          </li>
          <li>See only businesses whose owners chose to be found; nobody is pressured to sell.</li>
          <li>
            Ask for access to evidence for a set time and purpose, and check every number against
            its source on NEAR.
          </li>
          <li>
            Agree exact terms that both sides accept on NEAR, and take over without breaking a
            single customer's balance or booking.
          </li>
        </ul>
      </div>
      <div className="card">
        <h2>Already proven on NEAR testnet</h2>
        <p className="muted">
          A sample business, OpenSeat, was sold from its founder to a buyer on testnet. The
          founder's access ended everywhere, and a customer who joined the waitlist before the sale
          got their seat afterwards with the same reference.
        </p>
        <a
          className="btn btn-secondary"
          href="https://testnet.nearblocks.io/txns/64bggSVqanKEX9ddWiSdHyYnyXnDuQ3ELZ5ekAmv4dsP"
          target="_blank"
          rel="noreferrer"
        >
          See the recorded sale (testnet, Nov 1 2026)
        </a>
      </div>
      <p className="muted">
        Meanwhile, <Link to="/start">start a business</Link> or{" "}
        <Link to="/find">find a solution</Link>.
      </p>
    </div>
  );
}
