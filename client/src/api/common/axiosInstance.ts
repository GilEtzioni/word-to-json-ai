import axios from "axios";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

const axiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  withCredentials: true,
});

export default axiosInstance;
