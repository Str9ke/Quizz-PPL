extends Node

signal room_visited(room_name: String)

var visited_rooms: Dictionary = {}

func mark_room_visited(room_name: String) -> void:
	if visited_rooms.has(room_name):
		return
	visited_rooms[room_name] = true
	room_visited.emit(room_name)
	print("Carte : %s decouverte." % room_name)

func is_room_visited(room_name: String) -> bool:
	return visited_rooms.has(room_name)

func get_visited_rooms() -> Array:
	return visited_rooms.keys()
