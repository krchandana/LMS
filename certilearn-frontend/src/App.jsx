import { BrowserRouter, Routes, Route } from "react-router-dom";
import AdminLogin from "./pages/Admin/AdminLogin";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLogin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;