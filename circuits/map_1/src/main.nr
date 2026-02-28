fn main(x: Field, y: Field, nullifier: Field, xy_nullifier_hashed: pub Field) {
    let h: Field = std::hash::pedersen_hash([x, y, nullifier]);
    assert(h == xy_nullifier_hashed);
}

#[test]
fn test_print_hash() {
    let h = std::hash::pedersen_hash([3, 5, 42]);
    std::println(h);
}
