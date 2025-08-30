import React, { useState, useEffect } from "react";
import { db, storage } from "../firebaseConfig";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  orderBy,
  query,
} from "firebase/firestore";
import { Button, Table } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { deleteObject, ref } from "firebase/storage";
import Loader from "./Loader";

const EventTable = () => {
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]); // ✅ filtered events
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [filter, setFilter] = useState("All"); // ✅ filter state
  const [activefilter, setActiveFilter] = useState("All"); // ✅ active filter]
  const navigate = useNavigate();

  // Fetch events from Firestore
  const fetchEvents = async () => {
    const eventsRef = collection(db, "events");
    const q = query(eventsRef, orderBy("createdAt", "desc"));

    const querySnapshot = await getDocs(q);
    const eventsList = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    setEvents(eventsList);
    setFilteredEvents(eventsList); // ✅ show all initially
  };

  // Delete event
  const handleDelete = async (id) => {
    setLoading(true);
    setDeletingId(id);
    try {
      const eventDocRef = doc(db, "events", id);
      const eventDoc = await getDoc(eventDocRef);

      if (eventDoc.exists()) {
        const eventData = eventDoc.data();
        const mainImageUrl = eventData.mainImage;
        const imagesUrls = eventData.images || [];

        // Delete all associated images
        const deleteImagePromises = imagesUrls.map((url) => {
          const imageRef = ref(storage, url);
          return deleteObject(imageRef).catch((error) => {
            console.warn(
              `Image at ${url} not found or failed to delete:`,
              error
            );
          });
        });

        if (mainImageUrl) {
          const mainImageRef = ref(storage, mainImageUrl);
          await deleteObject(mainImageRef).catch((error) => {
            console.warn(
              `Main image at ${mainImageUrl} not found or failed to delete:`,
              error
            );
          });
        }

        await Promise.all(deleteImagePromises);
        await deleteDoc(eventDocRef);

        fetchEvents();
      }
    } catch (error) {
      console.error("Error deleting event:", error);
    } finally {
      setLoading(false);
      setDeletingId(null);
    }
  };

  // ✅ Apply filter
  useEffect(() => {
    if (filter === "All") {
      setFilteredEvents(events);
      setActiveFilter("All Events");
    } else if (filter === "Others") {
      setFilteredEvents(
        events.filter(
          (event) =>
            !["Health", "Education", "Sports", "Womens Empowerment"].includes(
              event.programType
            )
        )
      );
      setActiveFilter("Others");
    } else {
      setFilteredEvents(events.filter((event) => event.programType === filter));
      setActiveFilter(filter);
    }
  }, [filter, events]);

  useEffect(() => {
    fetchEvents();
  }, []);

  return (
    <div className="container mt-4">
      <div className="container d-flex flex-row gap-3 mb-4">
        <button
          className="btn btn-success text-white fw-bold"
          onClick={() => navigate("/event")}
        >
          Add Event +
        </button>

        {/* Filter Dropdown */}
        <div className="dropdown">
          <button
            className="btn fw-bold text-white dropdown-toggle"
            style={{ background: "#4584ddff" }}
            type="button"
            id="dropdownMenuButton"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            Filter By <i className="fas fa-filter"></i>
          </button>

          <ul className="dropdown-menu" aria-labelledby="dropdownMenuButton">
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("All")}
              >
                All Events
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Health")}
              >
                Health
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Education")}
              >
                Education
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Sports")}
              >
                Sports
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Womens Empowerment")}
              >
                Womens Empowerment
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Others")}
              >
                Filter by other events
              </button>
            </li>
          </ul>
        </div>
        <button className="btn text-sucess" style={{ background: "#e3fae7ff",color:"#008a09ff",border:"1px solid #008a09ff" }}>
          Fitered by {activefilter}
        </button>
      </div>

      <h2 className="mb-4">Events Table</h2>
      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Program</th>
            <th>Title</th>
            <th>Partner</th>
            <th>Location</th>
            <th>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredEvents.length === 0 && (
            <tr>
              <td colSpan="6">No events found.</td>
            </tr>
          )}
          {filteredEvents.map((event) => (
            <tr key={event.id}>
              <td>{event.programType}</td>
              <td>{event.title}</td>
              <td className="col-2">{event.partner}</td>
              <td className="col-3">{event.eventVenue}</td>
              <td className="col-1">{event.eventDate}</td>
              <td>
                <Button
                  variant="warning"
                  onClick={() => navigate(`/update/${event.id}`)}
                >
                  Update
                </Button>
                <Button
                  variant="danger"
                  className="ml-2 m-1"
                  onClick={() => handleDelete(event.id)}
                  disabled={loading && deletingId === event.id}
                >
                  {loading && deletingId === event.id
                    ? "Deleting..."
                    : "Delete"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {loading && <Loader />}
    </div>
  );
};

export default EventTable;
