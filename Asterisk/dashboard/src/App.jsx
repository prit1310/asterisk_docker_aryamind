import { useEffect, useState } from "react";

function App() {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    fetch("http://localhost:3002/api/calls")
      .then(res => res.json())
      .then(data => setCalls(data));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">📞 Asterisk Call Logs</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-200 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-3 py-2">Caller</th>
              <th className="border px-3 py-2">Callee</th>
              <th className="border px-3 py-2">Start</th>
              <th className="border px-3 py-2">End</th>
              <th className="border px-3 py-2">Duration (s)</th>
              <th className="border px-3 py-2">Recording</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, idx) => (
              <tr key={idx}>
                <td className="border px-3 py-2">{call.caller}</td>
                <td className="border px-3 py-2">{call.callee}</td>
                <td className="border px-3 py-2">{new Date(call.startTime).toLocaleString()}</td>
                <td className="border px-3 py-2">{call.endTime ? new Date(call.endTime).toLocaleString() : "-"}</td>
                <td className="border px-3 py-2">{call.duration ?? "-"}</td>
                <td className="border px-3 py-2">
                  {call.recordingFile ? (
                    <a
                      className="text-blue-600 underline"
                      href={`/recordings/${call.recordingFile}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Listen
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
