"""Static fake clinic list: 5 clinics with clinic_id (uuid), name, rating, distance."""
import uuid

# Fictional +1-555-01xx numbers so CONFIRMED can call place_outbound_call (needs hospital_phone).
CLINICS = [
    {
        "clinic_id": str(uuid.uuid4()),
        "name": "Sunset Pet Care",
        "rating": 4.8,
        "distance": 1.2,
        "phone": "+15550100001",
    },
    {
        "clinic_id": str(uuid.uuid4()),
        "name": "Westside Animal Hospital",
        "rating": 4.5,
        "distance": 2.1,
        "phone": "+15550100002",
    },
    {
        "clinic_id": str(uuid.uuid4()),
        "name": "Downtown Vet Clinic",
        "rating": 4.9,
        "distance": 2.8,
        "phone": "+15550100003",
    },
    {
        "clinic_id": str(uuid.uuid4()),
        "name": "Paws & Claws Health",
        "rating": 4.3,
        "distance": 3.0,
        "phone": "+15550100004",
    },
    {
        "clinic_id": str(uuid.uuid4()),
        "name": "Happy Tails Veterinary",
        "rating": 4.6,
        "distance": 3.5,
        "phone": "+15550100005",
    },
]


def get_fake_clinics() -> list[dict]:
    """Return 5 static clinics. Same order every time."""
    return [dict(c) for c in CLINICS]
