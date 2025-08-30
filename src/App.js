// src/App.js
import React from 'react';
import Navbar from './components/Navbar';
import EventTable from './components/EventTable';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import UpdateEvent from './components/Update';
import Eventcsr from './components/Event_CSR';
import HomeData from './components/HomeData';
import Auth from './components/Auth';

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        {/* <Route path='/' element={<Auth />}></Route>  */}
        <Route path='/' element={<EventTable />}></Route>
        <Route path='/update/:id' element={<UpdateEvent />}></Route>
        <Route path='/event' element={<Eventcsr/>}/>
        <Route path='/header' element={<HomeData />}></Route>
      </Routes>
    </Router>
  );
}

export default App;
