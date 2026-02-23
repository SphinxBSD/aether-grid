use dep::poseidon::poseidon2::Poseidon2;

fn main(x: Field, y: Field, nullifier: Field, xy_nullifier_hashed: pub Field) {
    let h: Field = Poseidon2::hash([x, y, nullifier], 3);
    assert(h == xy_nullifier_hashed);
}

#[test]
fn test_print_hash() {
    let h = Poseidon2::hash([3, 5, 42], 3);
    std::println(h);
}
