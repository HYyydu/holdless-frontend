"""Static fake clinic list: 5 clinics with clinic_id (uuid), name, rating, distance."""
import uuid

CLINICS = [
    {"clinic_id": str(uuid.uuid4()), "name": "Sunset Pet Care", "rating": 4.8, "distance": 1.2},
    {"clinic_id": str(uuid.uuid4()), "name": "Westside Animal Hospital", "rating": 4.5, "distance": 2.1},
    {"clinic_id": str(uuid.uuid4()), "name": "Downtown Vet Clinic", "rating": 4.9, "distance": 2.8},
    {"clinic_id": str(uuid.uuid4()), "name": "Paws & Claws Health", "rating": 4.3, "distance": 3.0},
    {"clinic_id": str(uuid.uuid4()), "name": "Happy Tails Veterinary", "rating": 4.6, "distance": 3.5},
]


def get_fake_clinics() -> list[dict]:
    """Return 5 static clinics. Same order every time."""
    return [dict(c) for c in CLINICS]
