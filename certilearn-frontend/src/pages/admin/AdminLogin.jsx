import { useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

const AdminLogin = () => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-blue-100 to-blue-200 px-4">
      <div className="bg-white shadow-2xl rounded-2xl p-8 w-full max-w-md">

        {/* Logo */}
        <div className="flex justify-center mb-4">
          <div className="bg-blue-600 p-4 rounded-full">
            <ShieldCheck size={40} className="text-white" />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-center text-blue-700">
          CertiLearn LMS
        </h1>

        <p className="text-center text-gray-500 mt-2">
          Admin Login
        </p>

        {/* Form */}
        <form className="mt-8 space-y-5">

          {/* Email */}
          <div>
            <label className="block text-gray-700 font-medium mb-2">
              Email
            </label>

            <input
              type="email"
              placeholder="admin@example.com"
              className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-gray-700 font-medium mb-2">
              Password
            </label>

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="********"
                className="w-full border rounded-lg px-4 py-3 pr-12 focus:ring-2 focus:ring-blue-500 outline-none"
              />

              <button
                type="button"
                className="absolute right-4 top-3 text-gray-500"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
              </button>
            </div>
          </div>

          {/* Remember */}
          <div className="flex justify-between items-center text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" />
              Remember Me
            </label>

            <a href="#" className="text-blue-600 hover:underline">
              Forgot Password?
            </a>
          </div>

          {/* Button */}
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 transition duration-300 text-white py-3 rounded-lg font-semibold"
          >
            Login
          </button>

        </form>

      </div>
    </div>
  );
};

export default AdminLogin;