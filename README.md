# 🚨 RoadSOS

### AI-Powered Emergency Response & Road Safety Platform

---

## Team Details

**Team Name:** Team Mahaveer

**Team Members:**

* Rahul Dewangan
* Mandeep Singh
* Omkar Kendre

---

# Project Overview

RoadSOS is an AI-powered emergency response platform designed to reduce emergency response time during road accidents and critical incidents.

The application combines:

* AI-based accident detection
* Manual SOS activation
* Nearby emergency service discovery
* Offline emergency service packs
* Medical information vault
* Emergency contact management
* Community volunteer assistance
* Global emergency number support

RoadSOS is designed to work across countries and regions while maintaining offline functionality in low-connectivity environments.

---

# Problem Statement

Road accidents remain one of the leading causes of death worldwide.

Many victims are unable to:

* Call emergency services
* Share their location
* Provide medical information
* Reach assistance in remote areas

Existing emergency systems suffer from:

* Delayed reporting
* Internet dependency
* Fragmented emergency numbers
* Lack of automatic accident detection
* Poor support for offline environments

RoadSOS addresses these challenges through a unified emergency response platform.

---

# Key Features

## Manual SOS

* Hold SOS button for 3 seconds
* Context-aware emergency reporting
* Location attachment
* Emergency category selection

## AI Accident Detection

* TensorFlow Lite model
* Accelerometer monitoring
* Gyroscope monitoring
* Audio analysis
* Automatic emergency workflow triggering

## Emergency Categories

* Accident SOS
* Vehicle Issue SOS
* Medical SOS
* Police SOS
* Fire SOS
* Women Safety SOS
* Child Safety SOS
* Roadside Help SOS
* Custom Emergency SOS

## Help Someone Else

Allows bystanders to report emergencies for other victims.

## Nearby Emergency Services

Supports:

* Hospitals
* Ambulances
* Trauma Centres
* Police Stations
* Fire Stations
* Pharmacies
* Doctors
* Clinics
* Mechanics
* Towing Services
* Petrol Pumps
* Volunteers

## Offline Emergency Packs

Location-based downloadable packs containing emergency service information.

Supports offline emergency service discovery without internet connectivity.

## Emergency Contacts

* Add trusted contacts
* Multiple contact selection
* Device contact picker integration

## Medical Vault

Stores:

* Blood Group
* Allergies
* Chronic Conditions
* Medications
* Emergency Doctor
* Insurance Information
* Organ Donor Status
* Identification Marks

## Document Vault

Supports:

* Driving Licence
* Passport
* Aadhaar Card
* PAN Card
* Voter ID
* Country-specific documents

## Volunteer Mode

Allows users to act as community responders and receive nearby emergency alerts.

---

# AI Accident Detection Model

RoadSOS includes a lightweight TensorFlow Lite accident detection model.

### Model Inputs

* Accelerometer
* Gyroscope
* GPS Speed
* Audio Features

### Dataset

* 15,500 labeled sequences
* 8,000 normal driving samples
* 7,500 accident samples

### Model Architecture

* 1D Convolutional Neural Network (CNN)
* TensorFlow Lite deployment
* Real-time on-device inference

### Output

* Normal
* Accident Detected

---

# Technology Stack

| Component        | Technology              |
| ---------------- | ----------------------- |
| Frontend         | Android Native (Kotlin) |
| Architecture     | MVVM Inspired           |
| Backend          | Node.js + Express       |
| AI Engine        | TensorFlow Lite         |
| Online Maps      | Google Play Services    |
| Offline Maps     | OSMDroid                |
| Networking       | Retrofit + OkHttp       |
| Hosting          | Render                  |
| Serialization    | Gson                    |
| Async Processing | Kotlin Coroutines       |
| Navigation       | Jetpack Navigation      |
| Local Storage    | SharedPreferences       |

---

# Project Structure

```text
app/
├── auth/
├── ui/
│   ├── dashboard/
│   ├── contacts/
│   ├── nearby/
│   ├── vault/
│   ├── settings/
│   └── history/
├── data/
│   ├── models/
│   ├── PrefsManager.kt
│   ├── BackendClient.kt
│   └── CountryConfig.kt
├── assets/
│   ├── countries.json
│   └── model.tflite
└── backend/
```

# Installation & Running

## Quick Evaluation (Recommended)

The easiest way to evaluate RoadSOS is by installing the provided APK on an Android device.

### APK Installation

1. Locate the provided **RoadSOS.apk** file in the submission package.
2. Transfer the APK to an Android device if necessary.
3. Enable **Install from Unknown Sources** if prompted.
4. Install the application.
5. Launch RoadSOS and complete the onboarding process.
6. Grant the requested permissions for full functionality.

### Minimum Requirements

* Android 8.0 (API Level 26) or higher
* GPS / Location Services
* Accelerometer & Gyroscope Sensors
* Internet connection (recommended for online services)

### Features Recommended for Evaluation

* User Registration / Login
* Manual SOS Workflow
* Help Someone Else Workflow
* AI Protection Mode
* Nearby Emergency Services
* Emergency Contacts Management
* Medical Vault & Document Vault
* Offline Pack Download and Management
* Volunteer Mode
* Emergency History

### Important Notes

* OTP verification currently uses a testing/simulated OTP workflow.
* Emergency dispatch operates in simulation mode for demonstration purposes.
* Some map-based features require production API configuration.
* Offline functionality depends on downloaded regional emergency packs.

---

## Running from Source (Optional)

The project can also be built and executed directly from the source code using Android Studio. Follow the setup instructions provided in the sections below.

## Prerequisites

* Android Studio Hedgehog or later
* Android SDK 26+
* JDK 17
* Gradle

## Clone Repository

```bash
git clone <https://github.com/Rahul-dewangan01/RoadSOS>
```

## Open Project

Open the project in Android Studio.

## Configure Environment

Update:

```properties
BACKEND_BASE_URL=
GOOGLE_WEB_CLIENT_ID=
MAPS_API_KEY=
```

inside local configuration files.

## Build Application

```bash
./gradlew assembleDebug
```

or run directly through Android Studio.

## Backend

Navigate to backend directory:

```bash
cd backend
npm install
npm start
```

---

# Assumptions

* GPS is available on the device.
* Users grant required permissions.
* Emergency contacts are valid.
* Offline packs are downloaded when needed.
* Internet connectivity may not always be available.

---

# Current Limitations

* OTP verification uses testing/simulated OTP.
* Google Sign-In requires production OAuth configuration.
* Emergency dispatch currently operates in simulation mode.
* Direct integration with police, ambulance, and fire authorities is not yet implemented.
* Manual map selection requires production Google Maps API setup.
* Emergency history and vault data are stored locally.
* Cloud synchronization is not implemented.
* AI model primarily uses physics-simulated crash data.
* Offline service coverage depends on downloaded regional packs.

---

# Expected Output

The application should allow users to:

1. Register/Login
2. Configure emergency contacts
3. Store medical information
4. Enable AI Protection Mode
5. Trigger Manual SOS
6. Detect accidents automatically
7. Locate nearby emergency services
8. Access emergency resources offline
9. Manage offline packs
10. View emergency history

---

# Future Enhancements

* Real OTP Verification
* Direct Emergency Dispatch Integration
* Cloud Synchronization
* Wearable Device Integration
* Vehicle Telematics Integration
* Live Video Streaming
* Volunteer Verification Network
* Country-Level Offline Packs
* Accident Severity Classification
* Multi-Language Support
* iOS Application
* Smart City Integration

---

# Conclusion

RoadSOS combines AI-powered accident detection, offline-first emergency assistance, medical information management, and global emergency service support into a single platform.

The project aims to reduce emergency response times, improve accident reporting, and provide life-saving assistance regardless of connectivity conditions.

---

## Your Safety, Our Priority 🚨
