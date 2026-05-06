import React, { useEffect, useState } from 'react';
import { apiGet } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Icon } from '../shared/Icon';

export function SharePrescriptionScreen({ token }: { token: string }) {
  const ctx = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Determine the best API URL. 
    // If we are on localhost (like Puppeteer), and the context URL is a remote tunnel,
    // we might want to try localhost:4000 directly to avoid loopback issues.
    let baseUrl = ctx.apiBaseUrl || 'http://localhost:4000';
    if (window.location.hostname === 'localhost' && !baseUrl.includes('localhost')) {
      console.log('Detected local environment, trying local API fallback');
      baseUrl = 'http://localhost:4000';
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
  console.log("DATA=======", data)
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
  const filledVitals = Object.entries(data.vitals || {}).filter(([_, v]) => v);
  const diagnosisList = (data.diagnosis || '').split('|').map(s => s.trim()).filter(Boolean);

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh', padding: '20px 0' }}>
      <style>{`
        .share-container {
          width: 800px;
          margin: 0 auto;
          background: #fff;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          min-height: 1000px;
          position: relative;
          color: #1a1a1a;
          font-family: 'Inter', -apple-system, sans-serif;
        }

        .header {
          padding: 40px;
          border-bottom: 3px solid #1a56db;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          background: #fff;
        }

        .clinic-name { font-size: 24px; font-weight: 800; color: #1a1a1a; margin-bottom: 4px; }
        .clinic-addr { font-size: 11px; color: #6b7280; line-height: 1.5; }
        .doctor-block { text-align: right; }
        .dr-name { font-size: 18px; font-weight: 700; color: #1a1a1a; display: block; }
        .dr-cred { font-size: 11px; color: #6b7280; display: block; margin-top: 2px; }
        .dr-date { font-size: 12px; font-weight: 600; color: #1a56db; display: block; margin-top: 8px; }

        .patient-strip {
          background: #f8fafb;
          border-bottom: 1px solid #e9ebee;
          padding: 20px 40px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }
        .ps-field { display: flex; flex-direction: column; }
        .ps-value { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-bottom: 2px; display: block; }
        .ps-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }

        .content { padding: 30px 40px; }
        .section { margin-bottom: 24px; }
        .section-title {
          font-size: 11px;
          font-weight: 700;
          color: #1a56db;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .section-title::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }

        .vitals-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
        .vital-box { background: #f9fafb; border: 1px solid #e9ebee; border-radius: 6px; padding: 10px 6px; text-align: center; }
        .vital-lbl { font-size: 9px; font-weight: 600; color: #9ca3af; text-transform: uppercase; margin-bottom: 4px; display: block; }
        .vital-val { font-size: 15px; font-weight: 700; color: #1a1a1a; }
        .vital-unit { font-size: 9px; color: #6b7280; margin-left: 1px; }

        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip { padding: 4px 12px; border-radius: 20px; background: #e8eefb; border: 1px solid #c3d2f5; color: #1a56db; font-size: 12px; font-weight: 500; }

        .rx-table { width: 100%; border-collapse: collapse; }
        .rx-table th { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
        .rx-table td { padding: 12px; border-bottom: 1px solid #f3f4f6; font-size: 12.5px; vertical-align: top; }
        .med-name { font-weight: 700; color: #1a1a1a; }

        .notes-text { font-size: 12.5px; color: #374151; white-space: pre-wrap; line-height: 1.6; }

        .footer {
          margin-top: 40px;
          padding: 0 40px 40px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .foot-meta { font-size: 10px; color: #9ca3af; line-height: 1.6; }
        .signature-block { text-align: right; }
        .sig-line { border-bottom: 2px solid #1a1a1a; width: 180px; margin-bottom: 6px; }
        .sig-name { font-size: 13px; font-weight: 700; color: #1a1a1a; }
      `}</style>

      <div id="prescription-capture-area" className="share-container">
        <header className="header">
          <div>
            <div className="clinic-name">{data.clinicName || 'DigiRx'}</div>
            <div className="clinic-addr">
              {data.branchName || 'Main Branch'}{data.branchAddress ? ` · ${data.branchAddress}` : ''}<br />
              {data.branchAddress || ''} {data.branchPhone ? ` · ${data.branchPhone}` : ''}
            </div>
          </div>
          <div className="doctor-block">
            <span className="dr-name">Dr. {data.doctorName}</span>
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
            <span className="ps-value">{data.patientGender || '—'} · {data.patientAge ? `${data.patientAge}y` : '—'}</span>
            <span className="ps-label">Demographics</span>
          </div>
          <div className="ps-field">
            <span className="ps-value">B+</span>
            <span className="ps-label">Blood group</span>
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
                {filledVitals.map(([k, v]) => (
                  <div key={k} className="vital-box">
                    <span className="vital-lbl">{k.toUpperCase()}</span>
                    <span className="vital-val">{v}</span>
                  </div>
                ))}
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
                {diagnosisList.map((d, i) => <span key={i} className="chip">{d}</span>)}
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
            Generated via DigiRx Clinical Platform<br />
            This prescription is valid for 30 days from date of issue.
          </div>
          <div className="signature-block">
            <div className="sig-line"></div>
            <div className="sig-name">Dr. {data.doctorName}</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
