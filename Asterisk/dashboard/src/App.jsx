import { useEffect, useState } from "react";
import { FaSearch, FaSort } from "react-icons/fa";

function App() {
  const [calls, setCalls] = useState([]);
  const [filteredCalls, setFilteredCalls] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("startTime");
  const [sortOrder, setSortOrder] = useState("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    fetch("http://localhost:3002/api/calls")
      .then((res) => res.json())
      .then((data) => {
        const sorted = [...data].sort(
          (a, b) => new Date(b.startTime) - new Date(a.startTime)
        );
        setCalls(sorted);
        setFilteredCalls(sorted);
      });
  }, []);

  useEffect(() => {
    let result = [...calls];

    if (searchTerm) {
      result = result.filter(
        (call) =>
          call.caller.toLowerCase().includes(searchTerm.toLowerCase()) ||
          call.callee.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    result.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (!valA || !valB) return 0;
      return sortOrder === "asc"
        ? valA > valB
          ? 1
          : -1
        : valA < valB
          ? 1
          : -1;
    });

    setFilteredCalls(result);
    setCurrentPage(1);
  }, [searchTerm, sortField, sortOrder, calls]);

  const totalPages = Math.ceil(filteredCalls.length / itemsPerPage);
  const paginated = filteredCalls.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const formatDate = (d) =>
    d ? new Date(d).toLocaleString("en-GB") : "-";

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4">
      <div className="w-full max-w-7xl mx-auto px-4">
        <div className="w-full bg-white p-8 rounded-lg shadow-lg">
          <h1 className="text-3xl font-bold text-indigo-700 mb-6 flex items-center gap-2">
            📞 Asterisk Call Logs
          </h1>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
            <div className="relative w-full sm:w-1/2">
              <input
                type="text"
                placeholder="Search caller or callee..."
                className="border pl-10 pr-4 py-2 w-full rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <FaSearch className="absolute top-3 left-3 text-gray-400" />
            </div>
            <div className="text-gray-600">
              Page <b>{currentPage}</b> of <b>{totalPages}</b>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-gray-300">
            <table className="min-w-full bg-white text-sm text-left text-gray-800">
              <thead className="bg-indigo-50 text-gray-700 font-medium">
                <tr>
                  {[
                    ["Caller", "caller"],
                    ["Callee", "callee"],
                    ["Start", "startTime"],
                    ["End", "endTime"],
                    ["Duration (s)", "duration"],
                    ["Recording", null],
                  ].map(([label, field]) => (
                    <th
                      key={label}
                      onClick={() => field && toggleSort(field)}
                      className={`px-4 py-3 border-b ${field ? "cursor-pointer hover:text-indigo-500" : ""
                        }`}
                    >
                      <div className="flex items-center gap-1">
                        {label}
                        {field && <FaSort className="text-xs text-gray-400" />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-6 text-gray-500">
                      No records found.
                    </td>
                  </tr>
                ) : (
                  paginated.map((call, idx) => (
                    <tr
                      key={idx}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-4 py-2">{call.caller}</td>
                      <td className="px-4 py-2">{call.callee}</td>
                      <td className="px-4 py-2">{formatDate(call.startTime)}</td>
                      <td className="px-4 py-2">{formatDate(call.endTime)}</td>
                      <td className="px-4 py-2">{call.duration ?? "-"}</td>
                      <td className="px-4 py-2">
                        {call.recordingFile ? (
                          <audio
                            controls
                            className="w-40 rounded"
                            src={`http://localhost:3002/recordings/${call.recordingFile.split("/").pop()}`}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end items-center gap-2 mt-6">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;