import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Icon } from '../shared/Icon';

// Only Male / Female are surfaced; anything else shows as a dash.
function genderWord(g?: string): string {
  const u = (g ?? '').toUpperCase();
  if (u === 'MALE') return 'Male';
  if (u === 'FEMALE') return 'Female';
  return '—';
}

const VITAL_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'bp', label: 'BP', unit: 'mmHg' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'temp', label: 'Temp', unit: '°F' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm' },
  { key: 'rr', label: 'RR', unit: '/min' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'height', label: 'Height', unit: 'cm' },
];

export function SharePrescriptionScreen({ token }: { token: string }) {
  const { ctx } = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Determine the best API URL. 
    // If we are on localhost (like Puppeteer), and the context URL is a remote tunnel,
    // we might want to try localhost:4000 directly to avoid loopback issues.
    let baseUrl = ctx.apiBaseUrl || 'http://localhost:4000/';
    if (window.location.hostname === 'localhost' && !baseUrl.includes('localhost')) {
      console.log('Detected local environment, trying local API fallback');
      baseUrl = 'http://localhost:4000/';
    }

    const url = `${baseUrl}/share/prescriptions/${token}`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Prescription not found (Status ${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch(err => {
        console.error('Fetch error:', err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [token, ctx.apiBaseUrl]);

  console.log("DATA=======", data);

  if (error) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
        <div style={{ textAlign: 'center', maxWidth: 400, width: '100%', background: '#fff', padding: 32, borderRadius: 16, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', margin: '0 auto' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="xCircle" size={32} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Unable to load prescription</h2>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Preparing your prescription...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const dateStr = new Date(data.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const filledVitals = Object.entries(data.vitals || {}).filter(([_, v]) => v && String(v).trim());
  const diagnosisList = (data.diagnosis || '').split('|').map((s: string) => s.trim()).filter(Boolean);

  // Determine the best API URL for logo fallback.
  let baseUrl = ctx.apiBaseUrl || 'http://localhost:4000/';
  if (window.location.hostname === 'localhost' && !baseUrl.includes('localhost')) {
    baseUrl = 'http://localhost:4000/';
  }

  // Resolve dynamic branding inputs
  const brandColor = (data.primaryColor || '').trim() || '#1a56db';
  const headerName = (data.clinicDisplayName || '').trim() || data.clinicName || 'Clinic';
  const rxNo = `#${(data.prescriptionNo || data._id || '').slice(-6).toUpperCase()}`;

  // Resolve the clinic logo the same way the invoice / in-app prescription
  // do: a full URL is used as-is; otherwise load it from the public
  // GET /clinics/:id/logo endpoint (serves the uploaded logo regardless of
  // how its storage key is shaped).
  const logoSrc = data.clinicLogoUrl
    ? (data.clinicLogoUrl.startsWith('http://') || data.clinicLogoUrl.startsWith('https://'))
      ? data.clinicLogoUrl
      : data.clinicId
        ? `${baseUrl.replace(/\/+$/, '')}/clinics/${encodeURIComponent(data.clinicId)}/logo`
        : ''
    : '';

  const doctorName = data.doctorName
    ? data.doctorName.toLowerCase().startsWith('dr.')
      ? data.doctorName
      : `Dr. ${data.doctorName}`
    : 'Doctor';

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh', padding: '20px 0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        .share-container {
          width: 794px;
          margin: 0 auto;
          background: #fff;
          box-shadow: 0 4px 24px rgba(15,23,42,0.08);
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 28px 28px 36px;
          position: relative;
          color: #1a1a1a;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 13px;
          line-height: 1.5;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 14px;
          border-bottom: 2px solid var(--brand-color);
          margin-bottom: 20px;
          background: #fff;
        }

        .clinic-name {
          font-size: 28px;
          font-weight: 700;
          color: var(--brand-color);
          line-height: 1.1;
          margin-bottom: 6px;
        }

        .clinic-addr {
          font-size: 12px;
          color: #6b7280;
          font-weight: 400;
          line-height: 1.7;
        }

        .doctor-block {
          text-align: right;
        }

        .dr-name {
          font-size: 14px;
          font-weight: 700;
          color: #1a1a1a;
          display: block;
          margin-bottom: 2px;
        }

        .dr-cred {
          font-size: 11.5px;
          color: #6b7280;
          font-weight: 400;
          display: block;
          line-height: 1.6;
        }

        .dr-date {
          font-size: 12px;
          font-weight: 700;
          color: var(--brand-color);
          display: block;
          margin-top: 4px;
        }

        .rx-no-top {
          font-size: 11px;
          font-weight: 800;
          color: #1e293b;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .patient-strip {
          display: grid;
          grid-template-columns: 1.4fr 1.2fr 0.7fr 1.2fr;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 12px 20px;
          margin-bottom: 22px;
          gap: 0;
        }

        .ps-field {
          padding: 4px 12px 4px 0;
        }

        .ps-field:first-child {
          padding-left: 0;
        }

        .ps-value {
          font-size: 14px;
          font-weight: 700;
          color: #1a1a1a;
          display: block;
          margin-bottom: 2px;
        }

        .ps-label {
          font-size: 11px;
          color: #9ca3af;
          font-weight: 400;
          display: block;
        }

        .content {
          padding: 0;
        }

        .section {
          margin-bottom: 20px;
        }

        .section-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--brand-color);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 0 0 10px 0;
        }

        .vitals-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 8px;
        }

        .vital-box {
          background: #f9fafb;
          border: 1px solid #e9ebee;
          border-radius: 6px;
          padding: 10px 6px;
          text-align: center;
        }

        .vital-lbl {
          font-size: 9.5px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          display: block;
          margin-bottom: 5px;
        }

        .vital-val {
          font-size: 17px;
          font-weight: 700;
          color: #1a1a1a;
          line-height: 1;
        }

        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .chip {
          padding: 5px 14px;
          border-radius: 20px;
          background: #e8eefb;
          border: 1px solid #c3d2f5;
          color: var(--brand-color);
          font-size: 12px;
          font-weight: 500;
        }

        .rx-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .rx-table thead tr {
          background: #f3f4f6;
        }

        .rx-table th {
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          padding: 9px 12px;
          text-align: left;
          border-bottom: 1px solid #e5e7eb;
        }

        .rx-table td {
          padding: 12px 12px;
          border-bottom: 1px solid #f0f0f0;
          color: #1a1a1a;
          font-size: 13px;
          vertical-align: top;
        }

        .rx-table td.med-name {
          font-weight: 600;
          color: #1a1a1a;
        }

        .notes-text {
          font-size: 13px;
          color: #374151;
          white-space: pre-wrap;
          line-height: 1.6;
        }

        .footer {
          margin-top: 48px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding: 0;
        }

        .foot-meta {
          font-size: 10px;
          color: #9ca3af;
          line-height: 1.7;
        }
      `}</style>

      <div
        id="prescription-capture-area"
        className="share-container"
        style={{ ['--brand-color' as any]: brandColor }}
      >
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {logoSrc && (
              <img
                src={logoSrc}
                alt=""
                style={{ maxHeight: '60px', maxWidth: '120px', objectFit: 'contain' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <div>
              <div className="clinic-name">{headerName}</div>
              <div className="clinic-addr">
                {data.branchName || 'Main Branch'}<br />
                {data.branchAddress || ''} {data.branchPhone ? ` · ${data.branchPhone}` : ''}
              </div>
            </div>
          </div>
          <div className="doctor-block">
            <div className="rx-no-top">Rx No: {rxNo}</div>
            <span className="dr-name">{doctorName}</span>
            <span className="dr-cred">{data.doctorQuals || ''}</span>
            <span className="dr-cred">{data.doctorReg ? `Reg No: ${data.doctorReg}` : ''}</span>
            <span className="dr-date">{dateStr}</span>
          </div>
        </header>

        <section className="patient-strip">
          <div className="ps-field">
            <span className="ps-value">{data.patientName || '—'}</span>
            <span className="ps-label">Patient</span>
          </div>
          <div className="ps-field">
            <span className="ps-value">{genderWord(data.patientGender)} · {data.patientAge ? `${data.patientAge} yrs` : '—'}</span>
            <span className="ps-label">Demographics</span>
          </div>
          <div className="ps-field">
            <span className="ps-value">{data.patientPhone || '—'}</span>
            <span className="ps-label">Phone</span>
          </div>
        </section>

        <main className="content">
          {filledVitals.length > 0 && (
            <section className="section">
              <div className="section-title">Vitals</div>
              <div className="vitals-grid">
                {filledVitals.map(([k, v]) => {
                  const meta = VITAL_FIELDS.find((f) => f.key === k);
                  return (
                    <div key={k} className="vital-box">
                      <span className="vital-lbl">{meta?.label ?? k.toUpperCase()}</span>
                      <span className="vital-val">
                        {v as string}
                        {meta?.unit && (
                          <span style={{ fontSize: '11px', fontWeight: 500, color: '#6b7280', marginLeft: '2px' }}>
                            {meta.unit}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {data.chiefComplaint && (
            <section className="section">
              <div className="section-title">Chief Complaint</div>
              <p className="notes-text">{data.chiefComplaint}</p>
            </section>
          )}

          {diagnosisList.length > 0 && (
            <section className="section">
              <div className="section-title">Diagnosis</div>
              <div className="chips">
                {diagnosisList.map((d: string, i: number) => <span key={i} className="chip">{d}</span>)}
              </div>
            </section>
          )}

          {data.items && data.items.length > 0 && (
            <section className="section">
              <div className="section-title">Prescription (Rx)</div>
              <table className="rx-table">
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Medicine</th>
                    <th style={{ width: '14%' }}>Dose</th>
                    <th style={{ width: '16%' }}>Frequency</th>
                    <th style={{ width: '16%' }}>Duration</th>
                    <th>Instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it: any, i: number) => (
                    <tr key={i}>
                      <td className="med-name">{it.customName}</td>
                      <td>{it.dosage || '—'}</td>
                      <td>{it.frequency || '—'}</td>
                      <td>{it.duration || '—'}</td>
                      <td style={{ color: '#374151' }}>{it.instructions || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {data.followUpAt && (
            <section className="section">
              <div className="section-title">Follow-up</div>
              <p className="notes-text">
                {new Date(data.followUpAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            </section>
          )}

          {data.notes && (
            <section className="section">
              <div className="section-title">Notes</div>
              <p className="notes-text">{data.notes}</p>
            </section>
          )}
        </main>

        <footer className="footer">
          <div className="foot-meta">
            Generated by DigiRx · digirx.online<br />
            This prescription is valid for 30 days from the date of issue.
          </div>
          <div className="signature" style={{ textAlign: 'right' }}>
            <div className="line" style={{ borderBottom: '2px solid #0f172a', minWidth: '180px', marginBottom: '6px' }} />
            <div className="who" style={{ fontWeight: 700, color: '#0f172a' }}>{doctorName}</div>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
              {data.doctorQuals || ''}
              {data.doctorReg && <><br />Reg No: {data.doctorReg}</>}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

