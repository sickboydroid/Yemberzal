import ComplaintsPanel from '../components/ComplaintsPanel';

/** School: all complaint threads across the fleet, with resolve workflow. */
export default function ComplaintsPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Complaints</h1>
          <p>Threads opened by parents. Reply to chat back and forth; mark resolved with a closing message to lock the thread.</p>
        </div>
      </div>
      <div style={{ maxWidth: 760 }}>
        <ComplaintsPanel role="school" />
      </div>
    </div>
  );
}
